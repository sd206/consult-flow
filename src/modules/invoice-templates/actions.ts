'use server'

import { revalidatePath } from 'next/cache'
import { requireFirmRole } from '@/lib/auth/context'
import { fieldErrorsOf, type FormResult, str } from '@/lib/form'
import { createTemplate, deleteTemplate, setDefaultTemplate, updateTemplate } from './data'
import { templateInputSchema } from './schemas'

const BOOLS = ['showConsultant', 'showProject', 'showQuantity', 'showRate', 'showTaskNotes', 'showDailyDetail'] as const

function parseTemplate(formData: FormData) {
  const options: Record<string, unknown> = {
    accentColor: str(formData, 'accentColor'),
    paymentTermsText: str(formData, 'paymentTermsText'),
    footerText: str(formData, 'footerText'),
  }
  for (const key of BOOLS) options[key] = str(formData, key) === 'on'
  return templateInputSchema.safeParse({
    name: str(formData, 'name'),
    baseLayout: str(formData, 'baseLayout'),
    options,
  })
}

function done<T>(firmId: string, result: FormResult<T>): FormResult<T> {
  if (result.ok) revalidatePath(`/f/${firmId}/settings/templates`)
  return result
}

export async function createTemplateAction(firmId: string, formData: FormData): Promise<FormResult<{ id: string }>> {
  const { db } = await requireFirmRole(firmId, ['admin'])
  const parsed = parseTemplate(formData)
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, await createTemplate(db, firmId, parsed.data))
}

export async function updateTemplateAction(firmId: string, id: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, ['admin'])
  const parsed = parseTemplate(formData)
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, await updateTemplate(db, firmId, id, parsed.data))
}

export async function deleteTemplateAction(firmId: string, id: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, ['admin'])
  return done(firmId, await deleteTemplate(db, firmId, id))
}

export async function setDefaultTemplateAction(firmId: string, id: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, ['admin'])
  return done(firmId, await setDefaultTemplate(db, firmId, id))
}
