'use server'

import { revalidatePath } from 'next/cache'
import { requireFirmRole } from '@/lib/auth/context'
import { fieldErrorsOf, type FormResult, str } from '@/lib/form'
import { deletePayment, recordPayment, updatePaymentDetails } from './data'
import { paymentDetailsSchema, paymentInputSchema } from './schemas'
import {
  createUploadTargets,
  deleteAttachment,
  finalizeUploads,
  type DeclaredFile,
  type Rejected,
  type UploadedItem,
  type UploadTarget,
} from './storage'

const MANAGERS = ['admin', 'manager'] as const

function revalidate(firmId: string, invoiceId: string) {
  revalidatePath(`/f/${firmId}/invoices/${invoiceId}`)
  revalidatePath(`/f/${firmId}/invoices/unpaid`)
}

/** Records the payment only. Files go straight to storage afterwards (createUploadTargetsAction). */
export async function recordPaymentAction(
  firmId: string,
  invoiceId: string,
  formData: FormData,
): Promise<FormResult<{ id: string }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = paymentInputSchema.safeParse({
    amount: str(formData, 'amount'),
    paidOn: str(formData, 'paidOn'),
    method: str(formData, 'method'),
    reference: str(formData, 'reference'),
    notes: str(formData, 'notes'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const rec = await recordPayment(db, firmId, invoiceId, parsed.data)
  if (rec.ok) revalidate(firmId, invoiceId)
  return rec
}

export async function updatePaymentAction(
  firmId: string,
  invoiceId: string,
  paymentId: string,
  formData: FormData,
): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = paymentDetailsSchema.safeParse({
    paidOn: str(formData, 'paidOn'),
    method: str(formData, 'method'),
    reference: str(formData, 'reference'),
    notes: str(formData, 'notes'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const upd = await updatePaymentDetails(db, firmId, paymentId, parsed.data)
  if (upd.ok) revalidate(firmId, invoiceId)
  return upd
}

/** Signed upload targets for the files the browser is about to send straight to storage. */
export async function createUploadTargetsAction(
  firmId: string,
  invoiceId: string,
  paymentId: string,
  files: DeclaredFile[],
): Promise<FormResult<{ targets: UploadTarget[]; rejected: Rejected[] }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  void invoiceId // same signature as the other payment actions; scoping is by firm and payment
  return createUploadTargets(db, firmId, paymentId, files)
}

/** Checks the uploaded files and attaches the good ones to the payment. */
export async function finalizeUploadsAction(
  firmId: string,
  invoiceId: string,
  paymentId: string,
  items: UploadedItem[],
): Promise<FormResult<{ added: number; rejected: Rejected[] }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const result = await finalizeUploads(db, firmId, paymentId, items)
  if (result.ok && result.data.added > 0) revalidate(firmId, invoiceId)
  return result
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
  paymentId: string,
  attachmentId: string,
): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const result = await deleteAttachment(db, firmId, paymentId, attachmentId)
  if (result.ok) revalidate(firmId, invoiceId)
  return result
}
