'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireFirmRole } from '@/lib/auth/context'
import { fieldErrorsOf, type FormResult, str } from '@/lib/form'
import { fail, ok } from '@/lib/result'
import {
  createDraft,
  deleteDraft,
  deleteManualLine,
  getInvoice,
  issueInvoice,
  regenerateLines,
  saveManualLine,
  setDiscount,
  setLineDescription,
  updateDraftHeader,
  updatePeriod,
  voidInvoice,
} from './data'
import { generateAndStorePdf } from './pdf/storage'
import { builderSchema, discountSchema, headerSchema, lineDescriptionSchema, manualLineSchema, periodSchema } from './schemas'

const MANAGERS = ['admin', 'manager'] as const
const PDF_ERROR = "Invoice issued, but the PDF couldn't be created. Use Regenerate PDF."

function done<T>(firmId: string, invoiceId: string | null, result: FormResult<T>): FormResult<T> {
  if (result.ok) {
    revalidatePath(`/f/${firmId}/invoices`)
    if (invoiceId) revalidatePath(`/f/${firmId}/invoices/${invoiceId}`)
  }
  return result
}

/** Checked consultants, or null (all) when the form sends allConsultants=1. */
function consultantsOf(formData: FormData): string[] | null {
  if (str(formData, 'allConsultants') === '1') return null
  return formData.getAll('consultant').filter((v): v is string => typeof v === 'string' && v !== '')
}

export async function createDraftAction(firmId: string, formData: FormData): Promise<FormResult<{ id: string }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = builderSchema.safeParse({
    clientId: str(formData, 'clientId'),
    periodStart: str(formData, 'periodStart'),
    periodEnd: str(formData, 'periodEnd'),
    templateId: str(formData, 'templateId'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const result = await createDraft(db, firmId, { ...parsed.data, consultantIds: consultantsOf(formData) })
  if (!result.ok) return result
  done(firmId, null, result)
  redirect(`/f/${firmId}/invoices/${result.data.id}`)
}

export async function regenerateLinesAction(firmId: string, id: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  return done(firmId, id, await regenerateLines(db, firmId, id, consultantsOf(formData)))
}

export async function updateDraftHeaderAction(firmId: string, id: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = headerSchema.safeParse({
    subject: str(formData, 'subject'),
    issueDate: str(formData, 'issueDate'),
    dueDate: str(formData, 'dueDate'),
    taxPercent: str(formData, 'taxPercent'),
    templateId: str(formData, 'templateId'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, id, await updateDraftHeader(db, firmId, id, parsed.data))
}

export async function updatePeriodAction(firmId: string, id: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = periodSchema.safeParse({
    periodStart: str(formData, 'periodStart'),
    periodEnd: str(formData, 'periodEnd'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, id, await updatePeriod(db, firmId, id, { ...parsed.data, consultantIds: consultantsOf(formData) }))
}

export async function setLineDescriptionAction(
  firmId: string,
  invoiceId: string,
  lineId: string,
  formData: FormData,
): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = lineDescriptionSchema.safeParse({ description: str(formData, 'description') })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, invoiceId, await setLineDescription(db, firmId, lineId, parsed.data.description))
}

export async function saveManualLineAction(
  firmId: string,
  invoiceId: string,
  lineId: string | null,
  formData: FormData,
): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = manualLineSchema.safeParse({
    description: str(formData, 'description'),
    quantity: str(formData, 'quantity'),
    unitPrice: str(formData, 'unitPrice'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, invoiceId, await saveManualLine(db, firmId, invoiceId, { lineId, ...parsed.data }))
}

export async function deleteManualLineAction(firmId: string, invoiceId: string, lineId: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  return done(firmId, invoiceId, await deleteManualLine(db, firmId, lineId))
}

export async function setDiscountAction(firmId: string, id: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = discountSchema.safeParse({
    type: str(formData, 'type'),
    value: str(formData, 'value'),
    label: str(formData, 'label'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, id, await setDiscount(db, firmId, id, parsed.data))
}

export async function deleteDraftAction(firmId: string, id: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  return done(firmId, id, await deleteDraft(db, firmId, id))
}

export async function issueInvoiceAction(
  firmId: string,
  id: string,
): Promise<FormResult<{ number: string; pdfError: string | null }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const issued = await issueInvoice(db, firmId, id)
  if (!issued.ok) return issued
  // A PDF failure never undoes the issue.
  const pdf = await generateAndStorePdf(db, firmId, id).catch(() => null)
  return done(firmId, id, {
    ok: true,
    data: { number: issued.data.number, pdfError: pdf?.ok ? null : PDF_ERROR },
  })
}

export async function regeneratePdfAction(firmId: string, invoiceId: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const inv = await getInvoice(db, firmId, invoiceId)
  if (!inv.ok) return inv
  if (!['issued', 'partly_paid', 'paid'].includes(inv.data.status)) return fail('Only issued invoices have a PDF.')
  const pdf = await generateAndStorePdf(db, firmId, invoiceId)
  if (!pdf.ok) return pdf
  return done(firmId, invoiceId, ok(undefined))
}

export async function voidInvoiceAction(firmId: string, id: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  return done(firmId, id, await voidInvoice(db, firmId, id))
}
