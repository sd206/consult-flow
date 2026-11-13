import { redirect } from 'next/navigation'
import { createServerDb } from '@/lib/supabase/server'
import { SetPasswordForm } from './set-password-form'

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ change?: string }>
}) {
  const { change } = await searchParams
  const db = await createServerDb()
  const { data } = await db.auth.getUser()
  if (!data.user) redirect('/login')
  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center p-6">
      <SetPasswordForm change={change === '1'} />
    </main>
  )
}
