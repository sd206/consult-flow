'use server'

import { revalidatePath } from 'next/cache'
import { requireFirmRole } from '@/lib/auth/context'
import { fieldErrorsOf, type FormResult, str } from '@/lib/form'
import { siteUrl } from '@/lib/site-url'
import { createAdminDb } from '@/lib/supabase/admin'
import {
  addCostRate,
  createConsultant,
  deleteCostRate,
  linkOrInviteConsultant,
  setConsultantActive,
  updateConsultant,
} from './data'
import type { LoginOutcome } from './data'
import { consultantCreateSchema, consultantUpdateSchema, costRateSchema } from './schemas'

const MANAGERS = ['admin', 'manager'] as const

function done<T>(firmId: string, result: FormResult<T>, consultantId?: string): FormResult<T> {
  if (result.ok) {
    revalidatePath(`/f/${firmId}/consultants`)
    if (consultantId) revalidatePath(`/f/${firmId}/consultants/${consultantId}`)
  }
  return result
}

const personFields = (fd: FormData) => ({
  name: str(fd, 'name'),
  email: str(fd, 'email'),
  type: str(fd, 'type'),
  vendorId: str(fd, 'vendorId'),
})

export async function createConsultantAction(
  firmId: string,
  formData: FormData,
): Promise<FormResult<{ id: string }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = consultantCreateSchema.safeParse({
    ...personFields(formData),
    initialHourlyCost: str(formData, 'initialHourlyCost'),
    initialCostFrom: str(formData, 'initialCostFrom'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, await createConsultant(db, firmId, parsed.data))
}

export async function updateConsultantAction(
  firmId: string,
  id: string,
  formData: FormData,
): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = consultantUpdateSchema.safeParse(personFields(formData))
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, await updateConsultant(db, firmId, id, parsed.data), id)
}

export async function setConsultantActiveAction(
  firmId: string,
  id: string,
  active: boolean,
): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  return done(firmId, await setConsultantActive(db, firmId, id, active), id)
}

export async function addCostRateAction(
  firmId: string,
  consultantId: string,
  formData: FormData,
): Promise<FormResult<{ id: string }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = costRateSchema.safeParse({
    hourlyCost: str(formData, 'hourlyCost'),
    effectiveFrom: str(formData, 'effectiveFrom'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, await addCostRate(db, firmId, consultantId, parsed.data), consultantId)
}

export async function deleteCostRateAction(
  firmId: string,
  consultantId: string,
  rateId: string,
): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  return done(firmId, await deleteCostRate(db, firmId, rateId), consultantId)
}

/**
 * Give the consultant a login: link to an existing firm member with the same email, or invite
 * the email. Only Admins can do this (enforced again in inviteMember).
 */
export async function inviteConsultantAction(
  firmId: string,
  consultantId: string,
): Promise<FormResult<{ outcome: LoginOutcome }>> {
  const { db } = await requireFirmRole(firmId, ['admin'])
  const result = await linkOrInviteConsultant(
    db,
    createAdminDb(),
    firmId,
    consultantId,
    `${siteUrl()}/auth/callback`,
  )
  if (result.ok) revalidatePath(`/f/${firmId}/users`)
  return done(firmId, result, consultantId)
}
