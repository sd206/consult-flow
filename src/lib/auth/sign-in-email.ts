import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fail, ok, type Result } from '@/lib/result'
import { likeLiteral, normalizeEmail } from './invite'

export type SignInEmail = 'invite' | 'magiclink'

const NOT_SENT = "We couldn't send the email. Please try again."

/**
 * Emails an existing user a way in. Someone who never accepted their invitation gets the
 * invitation again; anyone else gets a one-time sign-in link (the "magic link" email).
 * `admin` must be the service-role client and the caller must already have checked permission.
 */
export async function emailSignIn(admin: SupabaseClient, email: string, redirectTo: string): Promise<Result<SignInEmail>> {
  const normalized = normalizeEmail(email)
  const { data: profile, error } = await admin
    .from('profiles')
    .select('user_id')
    .ilike('email', likeLiteral(normalized))
    .maybeSingle()
  if (error || !profile) {
    if (error) console.error('profile lookup failed', error)
    return fail(NOT_SENT)
  }

  const { data: found, error: userErr } = await admin.auth.admin.getUserById((profile as { user_id: string }).user_id)
  if (userErr || !found.user) {
    console.error('getUserById failed', userErr)
    return fail(NOT_SENT)
  }

  if (!found.user.email_confirmed_at) {
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(normalized, { redirectTo })
    if (inviteErr) {
      console.error('re-invite failed', inviteErr)
      return fail(NOT_SENT)
    }
    return ok('invite')
  }

  // Sent as the user would request it from the sign-in page, so it uses the magic-link template.
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: otpErr } = await anon.auth.signInWithOtp({
    email: normalized,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  })
  if (otpErr) {
    console.error('sign-in link email failed', otpErr)
    return fail(NOT_SENT)
  }
  return ok('magiclink')
}
