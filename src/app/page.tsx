import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth/context'

export default async function Home() {
  const { userId, isPlatformOwner, db } = await requireUser()

  const { data, error } = await db
    .from('firm_members')
    .select('firm_id, role, firms(name)')
    .eq('user_id', userId)
  if (error) console.error('firm list failed', error)

  const firms = (data ?? []).map((m) => {
    const f = Array.isArray(m.firms) ? m.firms[0] : m.firms
    return { id: m.firm_id, role: m.role, name: f?.name ?? 'Firm' }
  })

  if (!error && !isPlatformOwner && firms.length === 1) redirect(`/f/${firms[0].id}`)

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Consulting Ops</h1>
      {isPlatformOwner && (
        <p className="mt-4">
          <Link href="/platform/firms" className="underline">
            Platform
          </Link>
        </p>
      )}
      <h2 className="mt-6 text-lg font-medium">Your firms</h2>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          We could not load your firms.
        </p>
      ) : firms.length === 0 ? (
        <p className="mt-2 text-sm">You are not a member of any firm yet.</p>
      ) : (
        <ul className="mt-2 divide-y rounded border">
          {firms.map((f) => (
            <li key={f.id}>
              <Link href={`/f/${f.id}`} className="flex justify-between p-3 hover:bg-muted">
                <span>{f.name}</span>
                <span className="text-sm text-muted-foreground">{f.role}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
