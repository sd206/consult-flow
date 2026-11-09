'use server'

import { revalidatePath } from 'next/cache'
import { requireFirmRole, requireUser } from '@/lib/auth/context'
import { fail, type Result } from '@/lib/result'
import { siteUrl } from '@/lib/site-url'
import { createAdminDb } from '@/lib/supabase/admin'
import { createFirmWithAdmin, updateFirmSettings, uploadFirmLogo } from './data'
import { createFirmSchema, firmSettingsSchema } from './schemas'

export type SettingsFieldErrors = Partial<Record<string, string>>
export type SettingsResult = Result<void> & { fieldErrors?: SettingsFieldErrors }

const str = (fd: FormData, key: string): string => {
  const v = fd.get(key)
  return typeof v === 'string' ? v : ''
}

export async function updateFirmSettingsAction(
  firmId: string,
  formData: FormData,
): Promise<SettingsResult> {
  const { db } = await requireFirmRole(firmId, ['admin'])
  const parsed = firmSettingsSchema.safeParse({
    name: str(formData, 'name'),
    address: str(formData, 'address'),
    contactName: str(formData, 'contactName'),
    contactEmail: str(formData, 'contactEmail'),
    contactPhone: str(formData, 'contactPhone'),
    currency: str(formData, 'currency'),
    defaultTaxPercent: str(formData, 'defaultTaxPercent'),
    defaultPaymentTermsDays: str(formData, 'defaultPaymentTermsDays'),
    invoiceNumberPattern: str(formData, 'invoiceNumberPattern'),
  })
  if (!parsed.success) {
    const fieldErrors: SettingsFieldErrors = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '')
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { ok: false, error: 'Check the highlighted fields.', fieldErrors }
  }
  const result = await updateFirmSettings(db, firmId, parsed.data)
  if (result.ok) revalidatePath(`/f/${firmId}`, 'layout')
  return result
}

export async function uploadFirmLogoAction(
  firmId: string,
  formData: FormData,
): Promise<Result<{ logoPath: string }>> {
  const { db } = await requireFirmRole(firmId, ['admin'])
  const LOGO_ERROR = 'Logo must be a PNG or JPEG under 2 MB.'
  const file = formData.get('logo')
  if (!(file instanceof File) || file.size === 0) return fail('Choose a logo file to upload.')
  // Size is checked before the bytes are read.
  if (file.size > 2 * 1024 * 1024) return fail(LOGO_ERROR)

  const result = await uploadFirmLogo(db, firmId, {
    name: file.name,
    type: file.type,
    size: file.size,
    bytes: await file.arrayBuffer(),
  })
  if (result.ok) revalidatePath(`/f/${firmId}/settings`)
  return result
}

export async function createFirmAction(formData: FormData): Promise<Result<{ firmId: string }>> {
  const { isPlatformOwner } = await requireUser()
  if (!isPlatformOwner) return fail("You don't have permission to do that.")

  const parsed = createFirmSchema.safeParse({
    name: formData.get('name'),
    adminEmail: formData.get('adminEmail'),
  })
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form and try again.')

  const result = await createFirmWithAdmin(
    createAdminDb(),
    parsed.data,
    `${siteUrl()}/auth/callback`,
  )
  if (result.ok) revalidatePath('/platform/firms')
  return result
}
