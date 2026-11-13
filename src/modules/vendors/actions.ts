'use server'

import { revalidatePath } from 'next/cache'
import { requireFirmRole } from '@/lib/auth/context'
import { fieldErrorsOf, type FormResult, str } from '@/lib/form'
import { createVendor, deleteVendor, updateVendor } from './data'
import { vendorSchema } from './schemas'


function parseVendor(formData: FormData) {
  return vendorSchema.safeParse({
    name: str(formData, 'name'),
    contactName: str(formData, 'contactName'),
    email: str(formData, 'email'),
    phone: str(formData, 'phone'),
    address: str(formData, 'address'),
  })
}

function done<T>(firmId: string, result: FormResult<T>): FormResult<T> {
  if (result.ok) revalidatePath(`/f/${firmId}/vendors`)
  return result
}

export async function createVendorAction(firmId: string, formData: FormData): Promise<FormResult<{ id: string }>> {
  const { db } = await requireFirmRole(firmId, ['admin'])
  const parsed = parseVendor(formData)
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, await createVendor(db, firmId, parsed.data))
}

export async function updateVendorAction(firmId: string, id: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, ['admin'])
  const parsed = parseVendor(formData)
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, await updateVendor(db, firmId, id, parsed.data))
}

export async function deleteVendorAction(firmId: string, id: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, ['admin'])
  return done(firmId, await deleteVendor(db, firmId, id))
}
