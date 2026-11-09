import type { SupabaseClient } from '@supabase/supabase-js'
import { fail, ok, type Result } from '@/lib/result'

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Escape LIKE wildcards so ilike behaves as a case-insensitive equality. */
export function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

const GENERIC = 'Something went wrong. Please try again.'

/**
 * Finds the user with this email, or invites them. `admin` must be the service-role client
 * and the caller must already have checked permission.
 */
export async function findOrInviteUser(
  admin: SupabaseClient,
  email: string,
  redirectTo: string,
): Promise<Result<{ userId: string; invited: boolean }>> {
  const normalized = normalizeEmail(email)
  if (!normalized) return fail('Enter an email address.')

  const { data: existing, error } = await admin
    .from('profiles')
    .select('user_id')
    .ilike('email', likeLiteral(normalized))
    .maybeSingle()
  if (error) {
    console.error('profile lookup failed', error)
    return fail(GENERIC)
  }
  if (existing) return ok({ userId: (existing as { user_id: string }).user_id, invited: false })

  const { data, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(normalized, { redirectTo })
  if (inviteErr || !data.user) {
    console.error('inviteUserByEmail failed', inviteErr)
    return fail('We could not send an invitation to that email address.')
  }
  return ok({ userId: data.user.id, invited: true })
}
