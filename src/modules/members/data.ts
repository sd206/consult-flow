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
 * The user id of the member of `firmId` whose profile email matches `email` (case-insensitive),
 * or null. Uses the caller's own client: RLS lets any member read co-members and their profiles.
 */
export async function findFirmMemberByEmail(
  db: SupabaseClient,
  firmId: string,
  email: string,
): Promise<Result<string | null>> {
  const normalized = normalizeEmail(email)
  if (!normalized) return ok(null)
  const { data, error } = await db
    .from('firm_members')
    .select('user_id, profiles!inner(email)')
    .eq('firm_id', firmId)
    .ilike('profiles.email', likeLiteral(normalized))
    .limit(1)
  if (error) return fail(mapDbError(error))
  const row = (data ?? [])[0] as { user_id: string } | undefined
  return ok(row?.user_id ?? null)
}

/**
 * Links this firm's unlinked consultant row with `email` (if any) to the member `userId`.
 * Best effort: the link can always be made later from the consultant record.
 */
export async function linkConsultantByEmail(
  db: SupabaseClient,
  firmId: string,
  userId: string,
  email: string,
): Promise<void> {
  const normalized = normalizeEmail(email)
  if (!normalized) return
  const { error } = await db
    .from('consultants')
    .update({ user_id: userId })
    .eq('firm_id', firmId)
    .is('user_id', null)
    .ilike('email', likeLiteral(normalized))
  if (error) console.error('consultant link failed', error)
}

/**
 * `db` is the caller's own (RLS) client. The membership is inserted through `add_firm_member`
 * with that client, so the database re-checks the admin role and the audit log records the
 * caller as actor. The service-role `admin` client is used only to look up or invite the user.
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

  const { error: insErr } = await db.rpc('add_firm_member', {
    p_firm: firmId,
    p_user: user.data.userId,
    p_role: input.role,
  })
  if (insErr) return fail(mapDbError(insErr))

  // Any role can also be a consultant (e.g. a manager who bills hours).
  await linkConsultantByEmail(db, firmId, user.data.userId, email)
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
