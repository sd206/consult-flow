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
import { expenseInputSchema, newExpenseSchema } from './schemas'

const MANAGERS = ['admin', 'manager'] as const

function revalidate(firmId: string, expenseId?: string) {
  revalidatePath(`/f/${firmId}/expenses`)
  if (expenseId) revalidatePath(`/f/${firmId}/expenses/${expenseId}`)
}

function fields(formData: FormData) {
  return {
    spentOn: str(formData, 'spentOn'),
    categoryId: str(formData, 'categoryId'),
    payee: str(formData, 'payee'),
    amount: str(formData, 'amount'),
    clientId: str(formData, 'clientId'),
    projectId: str(formData, 'projectId'),
    notes: str(formData, 'notes'),
  }
}

function parseForm(formData: FormData) {
  return expenseInputSchema.safeParse(fields(formData))
}

async function create(firmId: string, formData: FormData): Promise<FormResult<{ id: string }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = newExpenseSchema.safeParse({ ...fields(formData), id: str(formData, 'id') })
  if (!parsed.success) {
    const bad = fieldErrorsOf(parsed.error)
    // The id is not a field the user can fix: report it as a plain error.
    return bad.fieldErrors?.id && Object.keys(bad.fieldErrors).length === 1 ? { ok: false, error: bad.fieldErrors.id } : bad
  }
  const { id, ...input } = parsed.data
  const created = await createExpense(db, firmId, input, id)
  if (created.ok) revalidate(firmId)
  return created
}

/** Creates the expense and opens it; receipts are added there (createExpenseUploadTargetsAction). */
export async function createExpenseAction(firmId: string, formData: FormData): Promise<FormResult> {
  const created = await create(firmId, formData)
  if (!created.ok) return created
  redirect(`/f/${firmId}/expenses/${created.data.id}?added=1`)
}

/**
 * Creates the expense and returns its id, for the new-expense form: the browser then sends the
 * receipts straight to storage and opens the expense itself (a redirect here would skip that).
 */
export async function createExpenseForUploadAction(firmId: string, formData: FormData): Promise<FormResult<{ id: string }>> {
  return create(firmId, formData)
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
  const result = await deleteAttachment(db, firmId, { kind: 'expense', id: expenseId }, attachmentId)
  if (result.ok) revalidate(firmId, expenseId)
  return result
}
