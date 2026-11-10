'use server'

import { revalidatePath } from 'next/cache'
import { requireFirmRole } from '@/lib/auth/context'
import { MAX_FILES_PER_UPLOAD, displayFileName } from '@/lib/domain/attachments'
import { fieldErrorsOf, type FormResult, str } from '@/lib/form'
import { fail, ok } from '@/lib/result'
import { deletePayment, recordPayment, updatePaymentDetails, type UploadFile } from './data'
import { paymentDetailsSchema, paymentInputSchema } from './schemas'
import { attachFiles, deleteAttachment } from './storage'

const MANAGERS = ['admin', 'manager'] as const
const TOO_MANY = 'Attach up to 5 files at a time.'

function revalidate(firmId: string, invoiceId: string) {
  revalidatePath(`/f/${firmId}/invoices/${invoiceId}`)
  revalidatePath(`/f/${firmId}/invoices/unpaid`)
}

/** Chosen files only: browsers send one empty, nameless File when nothing was picked. */
function filesOf(formData: FormData): File[] {
  return formData
    .getAll('files')
    .filter((v): v is File => typeof v !== 'string' && typeof (v as File).arrayBuffer === 'function')
    .filter((f) => !(f.size === 0 && f.name === ''))
}

async function toUploads(files: File[]): Promise<UploadFile[]> {
  return Promise.all(
    files.map(async (f) => ({ name: f.name, type: f.type, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) })),
  )
}

function warningFor(names: string[]): string | null {
  return names.length === 0 ? null : `Payment recorded, but some files weren't attached: ${names.join(', ')}.`
}

/** Attaches the files; returns the names that did not make it. A file problem never fails the caller. */
async function attachAll(
  db: Parameters<typeof attachFiles>[0],
  firmId: string,
  paymentId: string,
  files: File[],
): Promise<string[]> {
  if (files.length === 0) return []
  const uploads = await toUploads(files)
  const r = await attachFiles(db, firmId, paymentId, uploads)
  if (!r.ok) return uploads.map((u) => displayFileName(u.name))
  return r.data.rejected.map((x) => x.name)
}

export async function recordPaymentAction(
  firmId: string,
  invoiceId: string,
  formData: FormData,
): Promise<FormResult<{ id: string; fileWarning: string | null }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = paymentInputSchema.safeParse({
    amount: str(formData, 'amount'),
    paidOn: str(formData, 'paidOn'),
    method: str(formData, 'method'),
    reference: str(formData, 'reference'),
    notes: str(formData, 'notes'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const files = filesOf(formData)
  if (files.length > MAX_FILES_PER_UPLOAD) return { ...fail(TOO_MANY), fieldErrors: { files: TOO_MANY } }

  const rec = await recordPayment(db, firmId, invoiceId, parsed.data)
  if (!rec.ok) return rec
  const failed = await attachAll(db, firmId, rec.data.id, files)
  revalidate(firmId, invoiceId)
  return ok({ id: rec.data.id, fileWarning: warningFor(failed) })
}

export async function updatePaymentAction(
  firmId: string,
  invoiceId: string,
  paymentId: string,
  formData: FormData,
): Promise<FormResult<{ fileWarning: string | null }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = paymentDetailsSchema.safeParse({
    paidOn: str(formData, 'paidOn'),
    method: str(formData, 'method'),
    reference: str(formData, 'reference'),
    notes: str(formData, 'notes'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const files = filesOf(formData)
  if (files.length > MAX_FILES_PER_UPLOAD) return { ...fail(TOO_MANY), fieldErrors: { files: TOO_MANY } }

  const upd = await updatePaymentDetails(db, firmId, paymentId, parsed.data)
  if (!upd.ok) return upd
  const failed = await attachAll(db, firmId, paymentId, files)
  revalidate(firmId, invoiceId)
  const warning =
    failed.length === 0 ? null : `Payment updated, but some files weren't attached: ${failed.join(', ')}.`
  return ok({ fileWarning: warning })
}

export async function deletePaymentAction(firmId: string, invoiceId: string, paymentId: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const result = await deletePayment(db, firmId, paymentId)
  if (result.ok) revalidate(firmId, invoiceId)
  return result
}

export async function deleteAttachmentAction(
  firmId: string,
  invoiceId: string,
  attachmentId: string,
): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const result = await deleteAttachment(db, firmId, attachmentId)
  if (result.ok) revalidate(firmId, invoiceId)
  return result
}
