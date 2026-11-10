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
import { BUCKET, ensurePaymentInFirm } from './data'

const NOT_FOUND = 'File not found.'
const PAYMENT_NOT_FOUND = 'Payment not found.'
const LOCKED = "Payments on this invoice can't be changed."
const UPLOAD_FAILED = "The file couldn't be uploaded."
const NOT_HERE = "That file doesn't belong here."
const INCOMING = 'incoming-'
const INCOMING_RE = /^incoming-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** How long the browser has to start a download after the redirect. */
const DOWNLOAD_SECONDS = 60

export type Validate = typeof validateAttachment
export type Rejected = { name: string; error: string }
export type DeclaredFile = { name: string; size: number }
export type UploadTarget = { index: number; uploadPath: string; token: string }
export type UploadedItem = { uploadPath: string; name: string }

function folderOf(firmId: string, paymentId: string): string {
  return `firms/${firmId}/attachments/payments/${paymentId}/`
}

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

/**
 * Step 1 of an upload: one signed upload target per acceptable file, in the payment's folder.
 * The browser sends the bytes straight to storage; finalizeUploads checks them afterwards.
 */
export async function createUploadTargets(
  db: SupabaseClient,
  firmId: string,
  paymentId: string,
  files: DeclaredFile[],
): Promise<Result<{ targets: UploadTarget[]; rejected: Rejected[] }>> {
  if (!Array.isArray(files)) return fail(UPLOAD_FAILED)
  if (files.length > MAX_FILES_PER_UPLOAD) return fail(TOO_MANY_FILES)
  const scope = await ensurePaymentTakesFiles(db, firmId, paymentId)
  if (!scope.ok) return scope

  const targets: UploadTarget[] = []
  const rejected: Rejected[] = []
  for (const [index, file] of files.entries()) {
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
    const path = `${folderOf(firmId, paymentId)}${INCOMING}${randomUUID()}`
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

async function removeQuietly(db: SupabaseClient, paths: string[]) {
  const rm = await db.storage.from(BUCKET).remove(paths)
  if (rm.error) console.error('attachment file cleanup failed', rm.error)
}

/**
 * Step 2 of an upload: checks each uploaded object's real bytes, then moves it to its final
 * name and records it. Anything that fails is removed and reported, never attached.
 */
export async function finalizeUploads(
  db: SupabaseClient,
  firmId: string,
  paymentId: string,
  items: UploadedItem[],
  validate: Validate = validateAttachment,
): Promise<Result<{ added: number; rejected: Rejected[] }>> {
  if (!Array.isArray(items)) return fail(UPLOAD_FAILED)
  if (items.length > MAX_FILES_PER_UPLOAD) return fail(TOO_MANY_FILES)
  const scope = await ensurePaymentInFirm(db, firmId, paymentId)
  if (!scope.ok) return scope

  const folder = folderOf(firmId, paymentId)
  let added = 0
  const rejected: Rejected[] = []
  for (const item of items) {
    const name = displayFileName(typeof item?.name === 'string' ? item.name : '')
    const uploadPath = typeof item?.uploadPath === 'string' ? item.uploadPath : ''
    // Only this payment's incoming objects; anything else is left untouched.
    if (!uploadPath.startsWith(folder) || !INCOMING_RE.test(uploadPath.slice(folder.length))) {
      rejected.push({ name, error: NOT_HERE })
      continue
    }

    const dl = await db.storage.from(BUCKET).download(uploadPath)
    if (dl.error || !dl.data) {
      await removeQuietly(db, [uploadPath])
      rejected.push({ name, error: UPLOAD_FAILED })
      continue
    }
    const bytes = new Uint8Array(await dl.data.arrayBuffer())
    const info = validate({ name, type: '', size: bytes.length, bytes })
    if (!info.ok) {
      await removeQuietly(db, [uploadPath])
      rejected.push({ name, error: info.error })
      continue
    }

    const finalPath = `${folder}${randomUUID()}.${info.data.ext}`
    const mv = await db.storage.from(BUCKET).move(uploadPath, finalPath)
    if (mv.error) {
      console.error('attachment move failed', mv.error)
      await removeQuietly(db, [uploadPath, finalPath])
      rejected.push({ name, error: UPLOAD_FAILED })
      continue
    }
    const { error } = await db.rpc('add_payment_attachment', {
      p_payment: paymentId,
      p_storage_path: finalPath,
      p_file_name: name,
      p_mime: info.data.mime,
      p_size: bytes.length,
    })
    if (error) {
      await removeQuietly(db, [finalPath])
      rejected.push({ name, error: mapDbError(error) })
      continue
    }
    added += 1
  }
  return ok({ added, rejected })
}

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
  await removeQuietly(db, [data])
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
  const signed = await db.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, DOWNLOAD_SECONDS, { download: displayFileName(row.file_name) })
  if (signed.error || !signed.data) return fail(NOT_FOUND)
  return ok({ url: signed.data.signedUrl })
}
