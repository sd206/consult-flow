'use server'

import { revalidatePath } from 'next/cache'
import { requireFirmRole } from '@/lib/auth/context'
import { fail, type Result } from '@/lib/result'
import { siteUrl } from '@/lib/site-url'
import { createAdminDb } from '@/lib/supabase/admin'
import { emailSignIn, type SignInEmail } from '@/lib/auth/sign-in-email'
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
): Promise<Result<{ userId: string; invited: boolean; emailed: boolean }>> {
  const { db } = await requireFirmRole(firmId, ['admin'])
  const parsed = inviteMemberSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
  })
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? CHECK_FORM)

  const admin = createAdminDb()
  const redirectTo = `${siteUrl()}/auth/callback`
  const added = await inviteMember(db, admin, firmId, parsed.data, redirectTo)
  if (!added.ok) return added
  // Someone who already had a login gets no invitation email, so send them a sign-in link.
  const emailed = added.data.invited ? true : (await emailSignIn(admin, parsed.data.email, redirectTo)).ok
  return done(firmId, { ok: true, data: { ...added.data, emailed } })
}

/**
 * Emails a member who hasn't signed in yet: the invitation again if they never accepted it,
 * otherwise a one-time sign-in link.
 */
export async function resendSignInAction(firmId: string, formData: FormData): Promise<Result<{ sent: SignInEmail }>> {
  const { db } = await requireFirmRole(firmId, ['admin'])
  const userId = String(formData.get('userId') ?? '')
  const { data, error } = await db
    .from('firm_members')
    .select('user_id, profiles(email)')
    .eq('firm_id', firmId)
    .eq('user_id', userId)
    .maybeSingle()
  const profile = data ? (Array.isArray(data.profiles) ? data.profiles[0] : data.profiles) : null
  const email = (profile as { email?: string } | null)?.email
  if (error || !email) return fail('That person is not a member of this firm.')
  return done(firmId, await emailSignIn(createAdminDb(), email, `${siteUrl()}/auth/callback`).then((r) => (r.ok ? { ok: true as const, data: { sent: r.data } } : r)))
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
