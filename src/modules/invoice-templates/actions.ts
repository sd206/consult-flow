'use server'

import { revalidatePath } from 'next/cache'
import { requireFirmRole } from '@/lib/auth/context'
import { ZodError } from 'zod'
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

/** Zod reports option problems under `options`; surface them under the form field that caused them. */
function templateFieldErrors(error: ZodError) {
  return fieldErrorsOf(
    new ZodError(error.issues.map((i) => (i.path[0] === 'options' && i.path.length > 1 ? { ...i, path: i.path.slice(1) } : i))),
  )
}

function done<T>(firmId: string, result: FormResult<T>): FormResult<T> {
  if (result.ok) revalidatePath(`/f/${firmId}/settings/templates`)
  return result
}

export async function createTemplateAction(firmId: string, formData: FormData): Promise<FormResult<{ id: string }>> {
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const parsed = parseTemplate(formData)
  if (!parsed.success) return templateFieldErrors(parsed.error)
  return done(firmId, await createTemplate(db, firmId, parsed.data))
}

export async function updateTemplateAction(firmId: string, id: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const parsed = parseTemplate(formData)
  if (!parsed.success) return templateFieldErrors(parsed.error)
  return done(firmId, await updateTemplate(db, firmId, id, parsed.data))
}

export async function deleteTemplateAction(firmId: string, id: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  return done(firmId, await deleteTemplate(db, firmId, id))
}

export async function setDefaultTemplateAction(firmId: string, id: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  return done(firmId, await setDefaultTemplate(db, firmId, id))
}
