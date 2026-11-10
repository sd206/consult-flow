'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireFirmRole } from '@/lib/auth/context'
import { fieldErrorsOf, type FormResult, str } from '@/lib/form'
import {
  createUploadTargets,
  deleteAttachment,
  finalizeUploads,
  type DeclaredFile,
  type Rejected,
  type UploadedItem,
  type UploadTarget,
} from '@/modules/attachments/storage'
import { createExpense, deleteExpense, updateExpense } from './data'
import { expenseInputSchema } from './schemas'

const MANAGERS = ['admin', 'manager'] as const

function revalidate(firmId: string, expenseId?: string) {
  revalidatePath(`/f/${firmId}/expenses`)
  if (expenseId) revalidatePath(`/f/${firmId}/expenses/${expenseId}`)
}

function parseForm(formData: FormData) {
  return expenseInputSchema.safeParse({
    spentOn: str(formData, 'spentOn'),
    categoryId: str(formData, 'categoryId'),
    payee: str(formData, 'payee'),
    amount: str(formData, 'amount'),
    clientId: str(formData, 'clientId'),
    projectId: str(formData, 'projectId'),
    notes: str(formData, 'notes'),
  })
}

/** Creates the expense and opens it; receipts are added there (createExpenseUploadTargetsAction). */
export async function createExpenseAction(firmId: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = parseForm(formData)
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const created = await createExpense(db, firmId, parsed.data)
  if (!created.ok) return created
  revalidate(firmId)
  redirect(`/f/${firmId}/expenses/${created.data.id}?added=1`)
}

export async function updateExpenseAction(firmId: string, expenseId: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = parseForm(formData)
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const result = await updateExpense(db, firmId, expenseId, parsed.data)
  if (result.ok) revalidate(firmId, expenseId)
  return result
}

export async function deleteExpenseAction(firmId: string, expenseId: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const result = await deleteExpense(db, firmId, expenseId)
  if (result.ok) revalidate(firmId, expenseId)
  return result
}

/** Signed upload targets for the receipts the browser is about to send straight to storage. */
export async function createExpenseUploadTargetsAction(
  firmId: string,
  expenseId: string,
  files: DeclaredFile[],
): Promise<FormResult<{ targets: UploadTarget[]; rejected: Rejected[] }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  return createUploadTargets(db, firmId, { kind: 'expense', id: expenseId }, files)
}

/** Checks the uploaded files and attaches the good ones to the expense. */
export async function finalizeExpenseUploadsAction(
  firmId: string,
  expenseId: string,
  items: UploadedItem[],
): Promise<FormResult<{ added: number; rejected: Rejected[] }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const result = await finalizeUploads(db, firmId, { kind: 'expense', id: expenseId }, items)
  if (result.ok && result.data.added > 0) revalidate(firmId, expenseId)
  return result
}

export async function deleteExpenseAttachmentAction(
  firmId: string,
  expenseId: string,
  attachmentId: string,
): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const result = await deleteAttachment(db, firmId, attachmentId)
  if (result.ok) revalidate(firmId, expenseId)
  return result
}
