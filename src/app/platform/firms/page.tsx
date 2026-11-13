import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth/context'
import { AccountMenu } from '@/components/account-menu'
import { CreateFirmForm } from './create-firm-form'

const PAGE_SIZE = 50

type Row = { id: string; name: string; created_at: string; admin_emails: string[]; total_count: number }

export default async function PlatformFirmsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { isPlatformOwner, db, email } = await requireUser()
  if (!isPlatformOwner) notFound()
  const sp = await searchParams
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 100) : ''
  const pageNo = Math.max(1, Math.floor(Number(sp.page)) || 1)

  const { data, error } = await db.rpc('platform_firms', {
    p_search: q,
    p_limit: PAGE_SIZE,
    p_offset: (pageNo - 1) * PAGE_SIZE,
  })
  if (error) console.error('platform_firms failed', error)
  const rows = (data ?? []) as Row[]
  const total = rows[0]?.total_count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const href = (page: number) => {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (page > 1) p.set('page', String(page))
    const s = p.toString()
    return `/platform/firms${s ? `?${s}` : ''}`
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between rounded-lg bg-brand px-4 py-2 text-brand-foreground">
        <span className="font-semibold">Platform</span>
        <AccountMenu email={email} />
      </div>
      <h1 className="mt-6 text-2xl font-semibold">Firms</h1>

      <form method="get" aria-label="Search firms" className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="firm-search">Search by name</label>
          <input id="firm-search" name="q" defaultValue={q} className="h-8 w-64 rounded-lg border bg-card px-2 text-sm" />
        </div>
        <button type="submit" className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm font-medium">
          Search
        </button>
        {q && (
          <Link href="/platform/firms" className="pb-1.5 underline underline-offset-4">
            Clear
          </Link>
        )}
      </form>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          We could not load the firms.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm">{q ? 'No firms match that name.' : 'No firms yet.'}</p>
      ) : (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            Showing {(pageNo - 1) * PAGE_SIZE + 1}–{(pageNo - 1) * PAGE_SIZE + rows.length} of {total}, newest first
          </p>
          <table className="mt-2 w-full text-left text-sm">
            <caption className="sr-only">All firms</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Name
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Admins
                </th>
                <th scope="col" className="py-2 font-medium">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="border-b">
                  <td className="py-2 pr-4">{f.name}</td>
                  <td className="py-2 pr-4">{f.admin_emails.join(', ')}</td>
                  <td className="py-2">{new Date(f.created_at).toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <nav aria-label="Pages" className="mt-4 flex items-center gap-4 text-sm">
              {pageNo > 1 && (
                <Link href={href(pageNo - 1)} className="underline underline-offset-4">
                  Previous
                </Link>
              )}
              <span>
                Page {pageNo} of {pages}
              </span>
              {pageNo < pages && (
                <Link href={href(pageNo + 1)} className="underline underline-offset-4">
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}

      <h2 className="mt-8 text-lg font-medium">Create a firm</h2>
      <CreateFirmForm />
    </main>
  )
}
