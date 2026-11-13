'use server'

import { redirect } from 'next/navigation'
import { createServerDb } from '@/lib/supabase/server'

/** Ends the session (clears the auth cookies) and returns to the sign-in page. */
export async function signOutAction(): Promise<void> {
  const db = await createServerDb()
  const { error } = await db.auth.signOut()
  if (error) console.error('signOut failed', error)
  redirect('/login?signedOut=1')
}
