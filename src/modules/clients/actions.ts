'use server'

import { revalidatePath } from 'next/cache'
import { requireFirmRole } from '@/lib/auth/context'
import { fieldErrorsOf, type FormResult, str } from '@/lib/form'
import { createClient, deleteClient, setClientActive, updateClient } from './data'
import { clientSchema } from './schemas'

const MANAGERS = ['admin', 'manager'] as const

function parseClient(formData: FormData) {
  return clientSchema.safeParse({
    name: str(formData, 'name'),
    billingContactName: str(formData, 'billingContactName'),
    billingEmail: str(formData, 'billingEmail'),
    billingPhone: str(formData, 'billingPhone'),
    billingAddress: str(formData, 'billingAddress'),
  })
}

function done<T>(firmId: string, result: FormResult<T>): FormResult<T> {
  if (result.ok) {
    revalidatePath(`/f/${firmId}/clients`)
    revalidatePath(`/f/${firmId}/projects`)
  }
  return result
}

export async function createClientAction(firmId: string, formData: FormData): Promise<FormResult<{ id: string }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = parseClient(formData)
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, await createClient(db, firmId, parsed.data))
}

export async function updateClientAction(firmId: string, id: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = parseClient(formData)
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, await updateClient(db, firmId, id, parsed.data))
}

export async function setClientActiveAction(firmId: string, id: string, active: boolean): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  return done(firmId, await setClientActive(db, firmId, id, active))
}

export async function deleteClientAction(firmId: string, id: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  return done(firmId, await deleteClient(db, firmId, id))
}
