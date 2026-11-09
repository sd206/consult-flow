import { NextResponse, type NextRequest } from 'next/server'
import { safeNext } from '@/lib/auth/safe-next'
import { createServerDb } from '@/lib/supabase/server'

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
  if (data.user?.user_metadata?.password_set !== true) {
    return NextResponse.redirect(`${origin}/auth/set-password`)
  }
  return NextResponse.redirect(`${origin}${safeNext(searchParams.get('next'))}`)
}
