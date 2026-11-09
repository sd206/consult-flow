import type { SupabaseClient } from '@supabase/supabase-js'
import { findOrInviteUser, likeLiteral, normalizeEmail } from '@/lib/auth/invite'
import { mapDbError } from '@/lib/db-errors'
import type { FirmRole } from '@/lib/db-types'
import { fail, ok, type Result } from '@/lib/result'

const DENIED = "You don't have permission to do that."

export type MemberRow = {
  userId: string
  email: string
  displayName: string | null
  role: FirmRole
}

export async function listMembers(db: SupabaseClient, firmId: string): Promise<Result<MemberRow[]>> {
  const { data, error } = await db
    .from('firm_members')
    .select('user_id, role, profiles(email, display_name)')
    .eq('firm_id', firmId)
  if (error) return fail(mapDbError(error))

  const rows: MemberRow[] = (data ?? []).map((m) => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    return {
      userId: m.user_id as string,
      email: (p?.email as string | undefined) ?? '',
      displayName: (p?.display_name as string | null | undefined) ?? null,
      role: m.role as FirmRole,
    }
  })
  rows.sort((a, b) => a.email.localeCompare(b.email))
  return ok(rows)
}

/**
 * `db` is the caller's own (RLS) client and is used to verify the caller is an admin of the
 * firm; only then is the service-role `admin` client used.
 */
export async function inviteMember(
  db: SupabaseClient,
  admin: SupabaseClient,
  firmId: string,
  input: { email: string; role: FirmRole },
  redirectTo: string,
): Promise<Result<{ userId: string; invited: boolean }>> {
  const { data: allowed, error: roleErr } = await db.rpc('has_role', {
    p_firm: firmId,
    p_roles: ['admin'],
  })
  if (roleErr) console.error('has_role failed', roleErr)
  if (allowed !== true) return fail(DENIED)

  const email = normalizeEmail(input.email)
  const user = await findOrInviteUser(admin, email, redirectTo)
  if (!user.ok) return user

  const { error: insErr } = await admin
    .from('firm_members')
    .insert({ firm_id: firmId, user_id: user.data.userId, role: input.role })
  if (insErr) return fail(mapDbError(insErr))

  if (input.role === 'consultant') {
    const { error: linkErr } = await admin
      .from('consultants')
      .update({ user_id: user.data.userId })
      .eq('firm_id', firmId)
      .is('user_id', null)
      .ilike('email', likeLiteral(email))
    // Membership exists already; a failed link can be fixed from the consultant record.
    if (linkErr) console.error('consultant link failed', linkErr)
  }
  return ok(user.data)
}

export async function changeMemberRole(
  db: SupabaseClient,
  firmId: string,
  userId: string,
  role: FirmRole,
): Promise<Result<void>> {
  const { data, error } = await db
    .from('firm_members')
    .update({ role })
    .eq('firm_id', firmId)
    .eq('user_id', userId)
    .select('id')
  if (error) return fail(mapDbError(error))
  // RLS filters rows silently: zero rows means not allowed or no such member.
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}

export async function removeMember(
  db: SupabaseClient,
  firmId: string,
  userId: string,
): Promise<Result<void>> {
  const { data, error } = await db
    .from('firm_members')
    .delete()
    .eq('firm_id', firmId)
    .eq('user_id', userId)
    .select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}
