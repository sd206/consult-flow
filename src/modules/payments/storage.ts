import 'server-only'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import { MAX_FILES_PER_UPLOAD, displayFileName, validateAttachment } from '@/lib/domain/attachments'
import { fail, ok, type Result } from '@/lib/result'
import { BUCKET, ensurePaymentInFirm, type UploadFile } from './data'

const NOT_FOUND = 'File not found.'
const UPLOAD_FAILED = "The file couldn't be uploaded."

type Validate = (file: UploadFile) => ReturnType<typeof validateAttachment>
type Rejected = { name: string; error: string }

export async function attachFiles(
  db: SupabaseClient,
  firmId: string,
  paymentId: string,
  files: UploadFile[],
  validate: Validate = validateAttachment,
): Promise<Result<{ added: number; rejected: Rejected[] }>> {
  if (files.length > MAX_FILES_PER_UPLOAD) return fail('Attach up to 5 files at a time.')
  const scope = await ensurePaymentInFirm(db, firmId, paymentId)
  if (!scope.ok) return scope

  let added = 0
  const rejected: Rejected[] = []
  for (const file of files) {
    const name = displayFileName(file.name)
    const info = validate(file)
    if (!info.ok) {
      rejected.push({ name, error: info.error })
      continue
    }
    const path = `firms/${firmId}/attachments/payments/${paymentId}/${randomUUID()}.${info.data.ext}`
    const up = await db.storage.from(BUCKET).upload(path, file.bytes, { contentType: info.data.mime })
    if (up.error) {
      console.error('attachment upload failed', up.error)
      rejected.push({ name, error: UPLOAD_FAILED })
      continue
    }
    const { error } = await db.rpc('add_payment_attachment', {
      p_payment: paymentId,
      p_storage_path: path,
      p_file_name: name,
      p_mime: info.data.mime,
      p_size: file.bytes.length,
    })
    if (error) {
      await db.storage.from(BUCKET).remove([path])
      rejected.push({ name, error: mapDbError(error) })
      continue
    }
    added += 1
  }
  return ok({ added, rejected })
}

async function ensureAttachmentInFirm(db: SupabaseClient, firmId: string, attachmentId: string): Promise<Result<void>> {
  const { data, error } = await db
    .from('attachments')
    .select('id')
    .eq('firm_id', firmId)
    .eq('id', attachmentId)
    .maybeSingle()
  if (error) return fail(mapDbError(error))
  return data ? ok(undefined) : fail(NOT_FOUND)
}

export async function deleteAttachment(db: SupabaseClient, firmId: string, attachmentId: string): Promise<Result<void>> {
  const scope = await ensureAttachmentInFirm(db, firmId, attachmentId)
  if (!scope.ok) return scope
  const { data, error } = await db.rpc('delete_attachment', { p_attachment: attachmentId })
  if (error || typeof data !== 'string') return fail(mapDbError(error))
  const rm = await db.storage.from(BUCKET).remove([data])
  if (rm.error) console.error('attachment file cleanup failed', rm.error)
  return ok(undefined)
}

export async function readAttachment(
  db: SupabaseClient,
  firmId: string,
  attachmentId: string,
): Promise<Result<{ bytes: Uint8Array; mimeType: string; fileName: string }>> {
  const { data, error } = await db
    .from('attachments')
    .select('storage_path, mime_type, file_name')
    .eq('firm_id', firmId)
    .eq('id', attachmentId)
    .maybeSingle()
  if (error) return fail(mapDbError(error))
  if (!data) return fail(NOT_FOUND)
  const row = data as { storage_path: string; mime_type: string; file_name: string }
  const dl = await db.storage.from(BUCKET).download(row.storage_path)
  if (dl.error || !dl.data) return fail(NOT_FOUND)
  return ok({ bytes: new Uint8Array(await dl.data.arrayBuffer()), mimeType: row.mime_type, fileName: row.file_name })
}
