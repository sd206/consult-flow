import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { validateAttachment } from '@/lib/domain/attachments'
import type { Result } from '@/lib/result'
import * as attachments from '@/modules/attachments/storage'
import type { DeclaredFile, Rejected, UploadedItem, UploadTarget, Validate } from '@/modules/attachments/storage'

/** Payment attachments: thin wrappers over the shared attachments module. */

export type { DeclaredFile, Rejected, UploadedItem, UploadTarget, Validate }

const payment = (id: string) => ({ kind: 'payment', id }) as const

/** Step 1 of an upload: signed upload targets in the payment's folder. */
export function createUploadTargets(
  db: SupabaseClient,
  firmId: string,
  paymentId: string,
  files: DeclaredFile[],
): Promise<Result<{ targets: UploadTarget[]; rejected: Rejected[] }>> {
  return attachments.createUploadTargets(db, firmId, payment(paymentId), files)
}

/** Step 2 of an upload: checks, moves and records the payment's uploaded files. */
export function finalizeUploads(
  db: SupabaseClient,
  firmId: string,
  paymentId: string,
  items: UploadedItem[],
  validate: Validate = validateAttachment,
): Promise<Result<{ added: number; rejected: Rejected[] }>> {
  return attachments.finalizeUploads(db, firmId, payment(paymentId), items, validate)
}

/** Deletes one of the payment's attachments; another owner's file is 'File not found.'. */
export function deleteAttachment(
  db: SupabaseClient,
  firmId: string,
  paymentId: string,
  attachmentId: string,
): Promise<Result<void>> {
  return attachments.deleteAttachment(db, firmId, payment(paymentId), attachmentId)
}
export const attachmentDownloadUrl = attachments.attachmentDownloadUrl
