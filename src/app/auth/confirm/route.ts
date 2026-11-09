import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { postLoginPath } from '@/lib/auth/post-login'
import { createServerDb } from '@/lib/supabase/server'

/**
 * Token-hash email links (invite, magic link, recovery). See supabase/templates/*.html.
 * Verified server-side, so no PKCE verifier or URL-fragment tokens are involved.
 */
const ALLOWED_TYPES: readonly EmailOtpType[] = ['invite', 'magiclink', 'recovery']

function isAllowedType(value: string | null): value is EmailOtpType {
  return value !== null && (ALLOWED_TYPES as readonly string[]).includes(value)
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  if (!tokenHash || !isAllowedType(type)) return NextResponse.redirect(`${origin}/login?error=link`)

  const db = await createServerDb()
  const { data, error } = await db.auth.verifyOtp({ type, token_hash: tokenHash })
  if (error || !data.user) {
    console.error('verifyOtp failed', error)
    return NextResponse.redirect(`${origin}/login?error=link`)
  }

  // A recovery link exists to choose a new password.
  const target = type === 'recovery' ? '/auth/set-password' : postLoginPath(data.user, searchParams.get('next'))
  return NextResponse.redirect(`${origin}${target}`)
}
