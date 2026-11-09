'use server'

import { revalidatePath } from 'next/cache'
import { requireFirmRole } from '@/lib/auth/context'
import { fail, type Result } from '@/lib/result'
import { siteUrl } from '@/lib/site-url'
import { createAdminDb } from '@/lib/supabase/admin'
import { changeMemberRole, inviteMember, removeMember } from './data'
import { changeRoleSchema, inviteMemberSchema, removeMemberSchema } from './schemas'

const CHECK_FORM = 'Check the form and try again.'

function done<T>(firmId: string, result: Result<T>): Result<T> {
  if (result.ok) revalidatePath(`/f/${firmId}/users`)
  return result
}

export async function inviteMemberAction(
  firmId: string,
  formData: FormData,
): Promise<Result<{ userId: string; invited: boolean }>> {
  const { db } = await requireFirmRole(firmId, ['admin'])
  const parsed = inviteMemberSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
  })
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? CHECK_FORM)

  return done(
    firmId,
    await inviteMember(
      db,
      createAdminDb(),
      firmId,
      parsed.data,
      `${siteUrl()}/auth/callback`,
    ),
  )
}

export async function changeMemberRoleAction(firmId: string, formData: FormData): Promise<Result<void>> {
  const { db } = await requireFirmRole(firmId, ['admin'])
  const parsed = changeRoleSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  })
  if (!parsed.success) return fail(CHECK_FORM)
  return done(firmId, await changeMemberRole(db, firmId, parsed.data.userId, parsed.data.role))
}

export async function removeMemberAction(firmId: string, formData: FormData): Promise<Result<void>> {
  const { db, userId: self } = await requireFirmRole(firmId, ['admin'])
  const parsed = removeMemberSchema.safeParse({ userId: formData.get('userId') })
  if (!parsed.success) return fail(CHECK_FORM)
  if (parsed.data.userId === self) return fail('You cannot remove yourself from the firm.')
  return done(firmId, await removeMember(db, firmId, parsed.data.userId))
}
