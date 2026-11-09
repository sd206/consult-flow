import { NextResponse, type NextRequest } from 'next/server'
import { postLoginPath } from '@/lib/auth/post-login'
import { createServerDb } from '@/lib/supabase/server'

/** PKCE code exchange (links whose verifier lives in this browser). Email links use /auth/confirm. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  if (!code) return NextResponse.redirect(`${origin}/login?error=link`)

  const db = await createServerDb()
  const { error } = await db.auth.exchangeCodeForSession(code)
  if (error) {
    console.error('exchangeCodeForSession failed', error)
    return NextResponse.redirect(`${origin}/login?error=link`)
  }

  const { data } = await db.auth.getUser()
  return NextResponse.redirect(`${origin}${postLoginPath(data.user, searchParams.get('next'))}`)
}
