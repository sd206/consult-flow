import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFirmRole } from '@/lib/auth/context'
import { listClients } from '@/modules/clients/data'
import { listCategories } from '@/modules/expense-categories/data'
import { getFirm } from '@/modules/firms/data'
import { getAccount, listLines, type LineStatus } from '@/modules/bank/data'
import { listIncomeCategories } from '@/modules/other-income/categories'
import { listProjects } from '@/modules/projects/data'
import { AccountForm } from '../account-form'
import { AccountStatusButton } from './account-status'
import { ReviewList } from './review-list'
import { UploadForm } from './upload-form'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TABS: { status: LineStatus; label: string }[] = [
  { status: 'new', label: 'To review' },
  { status: 'done', label: 'Done' },
  { status: 'ignored', label: 'Ignored' },
]

export default async function BankAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string; accountId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { firmId, accountId } = await params
  const sp = await searchParams
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  if (!UUID.test(accountId)) notFound()
  const account = await getAccount(db, firmId, accountId)
  if (!account.ok) notFound()
  const status: LineStatus = sp.status === 'done' || sp.status === 'ignored' ? sp.status : 'new'

  const [lines, cats, incomeCats, clients, projects, firm] = await Promise.all([
    listLines(db, accountId, status),
    listCategories(db, firmId),
    listIncomeCategories(db, firmId),
    listClients(db, firmId),
    listProjects(db, firmId),
    getFirm(db, firmId),
  ])
  const a = account.data
  const error = [lines, cats, incomeCats, clients, projects, firm].find((r) => !r.ok)
  const base = `/f/${firmId}/bank/${accountId}`

  return (
    <div className="max-w-6xl">
      <Link href={`/f/${firmId}/bank`} className="text-sm underline underline-offset-4">
        Bank accounts
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {a.name}
          {a.last4 && <span className="font-normal text-muted-foreground"> ····{a.last4}</span>}
        </h1>
        <span className="rounded-md border px-2 py-0.5 text-xs">{a.kind === 'bank' ? 'Bank' : 'Credit card'}</span>
        {!a.active && <span className="rounded-md border px-2 py-0.5 text-xs">Inactive</span>}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-primary">Account details</summary>
        <AccountForm firmId={firmId} account={a} />
        <div className="mt-3">
          <AccountStatusButton firmId={firmId} accountId={a.id} active={a.active} />
        </div>
      </details>

      {a.active && <UploadForm firmId={firmId} accountId={a.id} hasMapping={!!a.csvMapping} />}

      <nav aria-label="Line status" className="mt-8 flex gap-1 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={t.status === 'new' ? base : `${base}?status=${t.status}`}
            aria-current={status === t.status ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 ${status === t.status ? 'border-primary font-semibold text-primary' : 'border-transparent'}`}
          >
            {t.label}
            {t.status === 'new' && a.newCount > 0 ? ` (${a.newCount})` : ''}
          </Link>
        ))}
      </nav>

      {error && !error.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error.error}
        </p>
      ) : lines.ok && cats.ok && incomeCats.ok && clients.ok && projects.ok && firm.ok ? (
        <ReviewList
          firmId={firmId}
          accountId={a.id}
          status={status}
          currency={firm.data.currency}
          lines={lines.data}
          categories={cats.data.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))}
          incomeCategories={incomeCats.data.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))}
          clients={clients.data.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))}
          projects={projects.data
            .filter((p) => p.status !== 'closed')
            .map((p) => ({ id: p.id, name: p.name, clientId: p.clientId }))}
        />
      ) : null}
    </div>
  )
}
