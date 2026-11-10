import 'server-only'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import {
  EMPTY_FILE,
  FILE_TOO_LARGE,
  MAX_ATTACHMENT_BYTES,
  MAX_FILES_PER_UPLOAD,
  TOO_MANY_FILES,
  displayFileName,
  validateAttachment,
} from '@/lib/domain/attachments'
import { fail, ok, type Result } from '@/lib/result'
import { createAdminDb } from '@/lib/supabase/admin'

/*
 * Attachment files for payments and expenses.
 *
 * Storage write model: users may only create `incoming-{uuid}` objects in an owner folder
 * (via a signed upload target issued with their own client, so the insert policy applies).
 * Every move or removal is done here with the service role, and only after this module's
 * own firm, role and ownership checks, made with the user's client (RLS: admin/manager).
 */

export const BUCKET = 'firm-files'

const NOT_FOUND = 'File not found.'
const PAYMENT_NOT_FOUND = 'Payment not found.'
const EXPENSE_NOT_FOUND = 'Expense not found.'
const LOCKED = "Payments on this invoice can't be changed."
const UPLOAD_FAILED = "The file couldn't be uploaded."
const NOT_HERE = "That file doesn't belong here."
const INCOMING = 'incoming-'
export const INCOMING_RE = /^incoming-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** How long the browser has to start a download after the redirect. */
const DOWNLOAD_SECONDS = 60
/** Holding objects older than this were abandoned mid-upload. */
const STALE_INCOMING_MS = 24 * 60 * 60 * 1000
const LIST_PAGE = 100

export type Owner = { kind: 'payment'; id: string } | { kind: 'expense'; id: string }
export type Validate = typeof validateAttachment
export type Rejected = { name: string; error: string }
export type DeclaredFile = { name: string; size: number }
export type UploadTarget = { index: number; uploadPath: string; token: string }
export type UploadedItem = { uploadPath: string; name: string }

const KIND_FOLDER = { payment: 'payments', expense: 'expenses' } as const

export function ownerFolder(firmId: string, owner: Owner): string {
  return `firms/${firmId}/attachments/${KIND_FOLDER[owner.kind]}/${owner.id}/`
}

const files = () => createAdminDb().storage.from(BUCKET)

/** The payment is in this firm and its invoice still takes payment changes (issued, partly paid or paid). */
async function ensurePaymentTakesFiles(db: SupabaseClient, firmId: string, paymentId: string): Promise<Result<void>> {
  const pay = await db.from('payments').select('invoice_id').eq('firm_id', firmId).eq('id', paymentId).maybeSingle()
  if (pay.error) return fail(mapDbError(pay.error))
  if (!pay.data) return fail(PAYMENT_NOT_FOUND)
  const inv = await db
    .from('invoices')
    .select('status')
    .eq('firm_id', firmId)
    .eq('id', (pay.data as { invoice_id: string }).invoice_id)
    .maybeSingle()
  if (inv.error) return fail(mapDbError(inv.error))
  if (!inv.data) return fail(PAYMENT_NOT_FOUND)
  const status = (inv.data as { status: string }).status
  return ['issued', 'partly_paid', 'paid'].includes(status) ? ok(undefined) : fail(LOCKED)
}

/** The owner row exists in this firm and the user can see it (RLS: admin/manager only). */
async function ensureOwnerInFirm(db: SupabaseClient, firmId: string, owner: Owner): Promise<Result<void>> {
  const table = owner.kind === 'payment' ? 'payments' : 'expenses'
  const { data, error } = await db.from(table).select('id').eq('firm_id', firmId).eq('id', owner.id).maybeSingle()
  if (error) return fail(mapDbError(error))
  return data ? ok(undefined) : fail(owner.kind === 'payment' ? PAYMENT_NOT_FOUND : EXPENSE_NOT_FOUND)
}

/** Can this owner take new files right now? Payments follow their invoice status; expenses always can. */
function ensureOwnerTakesFiles(db: SupabaseClient, firmId: string, owner: Owner): Promise<Result<void>> {
  return owner.kind === 'payment' ? ensurePaymentTakesFiles(db, firmId, owner.id) : ensureOwnerInFirm(db, firmId, owner)
}

/** Every object (not sub-folder) directly in the owner folder, read with the service role. */
async function listOwnerObjects(firmId: string, owner: Owner): Promise<{ name: string; created_at: string | null }[]> {
  const dir = ownerFolder(firmId, owner).slice(0, -1)
  const out: { name: string; created_at: string | null }[] = []
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await files().list(dir, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`attachment folder list failed: ${error.message}`)
    const page = data ?? []
    for (const o of page) if (o.id !== null) out.push({ name: o.name, created_at: o.created_at ?? null })
    if (page.length < LIST_PAGE) return out
  }
}

async function removeQuietly(paths: string[]) {
  if (paths.length === 0) return
  const rm = await files().remove(paths)
  if (rm.error) console.error('attachment file cleanup failed', rm.error)
}

/**
 * Removes the owner's `incoming-*` objects created more than 24 hours before `now`
 * (uploads that were never finalized). Callers have already checked the owner.
 */
export async function sweepIncoming(firmId: string, owner: Owner, now: Date = new Date()): Promise<void> {
  const cutoff = now.getTime() - STALE_INCOMING_MS
  const folder = ownerFolder(firmId, owner)
  const stale = (await listOwnerObjects(firmId, owner))
    .filter((o) => INCOMING_RE.test(o.name) && o.created_at !== null && Date.parse(o.created_at) < cutoff)
    .map((o) => `${folder}${o.name}`)
  await removeQuietly(stale)
}

/** Sweeps, logging rather than failing: a stale holding object never blocks real work. */
async function sweepQuietly(firmId: string, owner: Owner) {
  try {
    await sweepIncoming(firmId, owner)
  } catch (e) {
    console.error('attachment incoming sweep failed', e)
  }
}

/** Removes every object in the owner's folder. Callers have already checked the owner (or deleted it). */
export async function removeOwnerFolder(firmId: string, owner: Owner): Promise<void> {
  const folder = ownerFolder(firmId, owner)
  const paths = (await listOwnerObjects(firmId, owner)).map((o) => `${folder}${o.name}`)
  for (let i = 0; i < paths.length; i += LIST_PAGE) await removeQuietly(paths.slice(i, i + LIST_PAGE))
}

/**
 * Step 1 of an upload: one signed upload target per acceptable file, in the owner's folder.
 * The browser sends the bytes straight to storage; finalizeUploads checks them afterwards.
 * Targets are signed with the user's client, so the storage insert policy authorizes the path.
 */
export async function createUploadTargets(
  db: SupabaseClient,
  firmId: string,
  owner: Owner,
  declared: DeclaredFile[],
): Promise<Result<{ targets: UploadTarget[]; rejected: Rejected[] }>> {
  if (!Array.isArray(declared)) return fail(UPLOAD_FAILED)
  if (declared.length > MAX_FILES_PER_UPLOAD) return fail(TOO_MANY_FILES)
  const scope = await ensureOwnerTakesFiles(db, firmId, owner)
  if (!scope.ok) return scope
  await sweepQuietly(firmId, owner)

  const folder = ownerFolder(firmId, owner)
  const targets: UploadTarget[] = []
  const rejected: Rejected[] = []
  for (const [index, file] of declared.entries()) {
    const name = displayFileName(typeof file?.name === 'string' ? file.name : '')
    const size = typeof file?.size === 'number' && Number.isFinite(file.size) ? file.size : 0
    if (size <= 0) {
      rejected.push({ name, error: EMPTY_FILE })
      continue
    }
    if (size > MAX_ATTACHMENT_BYTES) {
      rejected.push({ name, error: FILE_TOO_LARGE })
      continue
    }
    const path = `${folder}${INCOMING}${randomUUID()}`
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
    if (error || !data) {
      console.error('attachment upload target failed', error)
      rejected.push({ name, error: UPLOAD_FAILED })
      continue
    }
    targets.push({ index, uploadPath: data.path, token: data.token })
  }
  return ok({ targets, rejected })
}

async function register(
  db: SupabaseClient,
  owner: Owner,
  args: { path: string; name: string; mime: string; size: number },
) {
  const common = { p_storage_path: args.path, p_file_name: args.name, p_mime: args.mime, p_size: args.size }
  return owner.kind === 'payment'
    ? db.rpc('add_payment_attachment', { p_payment: owner.id, ...common })
    : db.rpc('add_expense_attachment', { p_expense: owner.id, ...common })
}

/**
 * Step 2 of an upload: checks each uploaded object's real bytes, then moves it to its final
 * name and records it. Anything that fails is removed and reported, never attached.
 */
export async function finalizeUploads(
  db: SupabaseClient,
  firmId: string,
  owner: Owner,
  items: UploadedItem[],
  validate: Validate = validateAttachment,
): Promise<Result<{ added: number; rejected: Rejected[] }>> {
  if (!Array.isArray(items)) return fail(UPLOAD_FAILED)
  if (items.length > MAX_FILES_PER_UPLOAD) return fail(TOO_MANY_FILES)
  const scope = await ensureOwnerInFirm(db, firmId, owner)
  if (!scope.ok) return scope
  await sweepQuietly(firmId, owner)

  const folder = ownerFolder(firmId, owner)
  const storage = files()
  let added = 0
  const rejected: Rejected[] = []
  for (const item of items) {
    const name = displayFileName(typeof item?.name === 'string' ? item.name : '')
    const uploadPath = typeof item?.uploadPath === 'string' ? item.uploadPath : ''
    // Only this owner's incoming objects; anything else is left untouched.
    if (!uploadPath.startsWith(folder) || !INCOMING_RE.test(uploadPath.slice(folder.length))) {
      rejected.push({ name, error: NOT_HERE })
      continue
    }

    const dl = await storage.download(uploadPath)
    if (dl.error || !dl.data) {
      await removeQuietly([uploadPath])
      rejected.push({ name, error: UPLOAD_FAILED })
      continue
    }
    const bytes = new Uint8Array(await dl.data.arrayBuffer())
    const info = validate({ name, type: '', size: bytes.length, bytes })
    if (!info.ok) {
      await removeQuietly([uploadPath])
      rejected.push({ name, error: info.error })
      continue
    }

    const finalPath = `${folder}${randomUUID()}.${info.data.ext}`
    const mv = await storage.move(uploadPath, finalPath)
    if (mv.error) {
      console.error('attachment move failed', mv.error)
      await removeQuietly([uploadPath, finalPath])
      rejected.push({ name, error: UPLOAD_FAILED })
      continue
    }
    const { error } = await register(db, owner, { path: finalPath, name, mime: info.data.mime, size: bytes.length })
    if (error) {
      await removeQuietly([finalPath])
      rejected.push({ name, error: mapDbError(error) })
      continue
    }
    added += 1
  }
  return ok({ added, rejected })
}

/** Deletes the attachment row (role and lock rules in the RPC, as the user), then its file. */
export async function deleteAttachment(db: SupabaseClient, firmId: string, attachmentId: string): Promise<Result<void>> {
  const { data: row, error: lookupError } = await db
    .from('attachments')
    .select('id')
    .eq('firm_id', firmId)
    .eq('id', attachmentId)
    .maybeSingle()
  if (lookupError) return fail(mapDbError(lookupError))
  if (!row) return fail(NOT_FOUND)
  const { data, error } = await db.rpc('delete_attachment', { p_attachment: attachmentId })
  if (error || typeof data !== 'string') return fail(mapDbError(error))
  // The RPC returns the row's own path; it must still lie in this firm's attachments.
  if (data.startsWith(`firms/${firmId}/attachments/`)) await removeQuietly([data])
  else console.error('attachment path outside firm folder; file left in place', data)
  return ok(undefined)
}

/** A short-lived signed link that downloads the file under its display name. */
export async function attachmentDownloadUrl(
  db: SupabaseClient,
  firmId: string,
  attachmentId: string,
): Promise<Result<{ url: string }>> {
  const { data, error } = await db
    .from('attachments')
    .select('storage_path, file_name')
    .eq('firm_id', firmId)
    .eq('id', attachmentId)
    .maybeSingle()
  if (error) return fail(mapDbError(error))
  if (!data) return fail(NOT_FOUND)
  const row = data as { storage_path: string; file_name: string }
  if (!row.storage_path.startsWith(`firms/${firmId}/attachments/`)) return fail(NOT_FOUND)
  const signed = await files().createSignedUrl(row.storage_path, DOWNLOAD_SECONDS, {
    download: displayFileName(row.file_name),
  })
  if (signed.error || !signed.data) return fail(NOT_FOUND)
  return ok({ url: signed.data.signedUrl })
}
