import type { SupabaseClient } from '@supabase/supabase-js'
import { findOrInviteUser } from '@/lib/auth/invite'
import { mapDbError } from '@/lib/db-errors'
import { fail, ok, type Result } from '@/lib/result'

/**
 * Platform-owner operation: `admin` is the service-role client and the caller has already
 * verified platform-owner status. The firm and its first admin membership are created in one
 * SQL function (single transaction), so a failure never leaves an orphan firm.
 */
export async function createFirmWithAdmin(
  admin: SupabaseClient,
  input: { name: string; adminEmail: string },
  redirectTo: string,
): Promise<Result<{ firmId: string }>> {
  const name = input.name.trim()
  if (!name) return fail('Enter a firm name.')

  const user = await findOrInviteUser(admin, input.adminEmail, redirectTo)
  if (!user.ok) return user

  const { data, error } = await admin.rpc('create_firm_with_admin', {
    p_name: name,
    p_admin: user.data.userId,
  })
  if (error || typeof data !== 'string') return fail(mapDbError(error))
  return ok({ firmId: data })
}
