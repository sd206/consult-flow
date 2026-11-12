import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireFirmRole } from '@/lib/auth/context'
import { isIsoDate, todayIso } from '@/lib/domain/dates'
import { formatMoney } from '@/lib/domain/money'
import { listClients } from '@/modules/clients/data'
import { getFirm } from '@/modules/firms/data'
import { listAllPayments, type BankFilter, type PaymentFilters } from '@/modules/payments/data'

const BANK_FILTERS: BankFilter[] = ['all', 'reconciled', 'unreconciled']

const th = 'py-2 pr-4 font-medium'
const td = 'py-2 pr-4 align-top'
const select = 'h-8 rounded-lg border bg-card px-2 text-sm'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const button = 'inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium'
const METHOD_LABEL: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  check: 'Check',
  card: 'Card',
  cash: 'Cash',
  other: 'Other',
}

type Sp = Record<string, string | string[] | undefined>

function one(sp: Sp, key: string): string | undefined {
  const v = sp[key]
  return typeof v === 'string' ? v : undefined
}

/** First and last day of the month of `today` (UTC). */
function monthBounds(today: string): { first: string; last: string } {
  const [y, m] = today.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { first: `${y}-${mm}-01`, last: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

/** A date param: absent means the default, blank or invalid means no bound. */
function dateParam(sp: Sp, key: string, fallback: string): string | null {
  const v = one(sp, key)
  if (v === undefined) return fallback
  return isIsoDate(v) ? v : null
}

export default async function PaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>
  searchParams: Promise<Sp>
}) {
  const { firmId } = await params
  const sp = await searchParams
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const { first, last } = monthBounds(todayIso())
  const client = one(sp, 'client')
  const filters: PaymentFilters = {
    from: dateParam(sp, 'from', first),
    to: dateParam(sp, 'to', last),
    clientId: client && UUID_RE.test(client) ? client : null,
    bank: BANK_FILTERS.includes(one(sp, 'bank') as BankFilter) ? (one(sp, 'bank') as BankFilter) : 'all',
  }
  const pageNo = Math.max(1, Math.floor(Number(one(sp, 'page'))) || 1)
  const [list, clients, firm] = await Promise.all([
    listAllPayments(db, firmId, filters, pageNo),
    listClients(db, firmId, { includeInactive: true }),
    getFirm(db, firmId),
  ])
  const base = `/f/${firmId}/payments`

  const query = (page: number) => {
    const q = new URLSearchParams()
    q.set('from', filters.from ?? '')
    q.set('to', filters.to ?? '')
    if (filters.clientId) q.set('client', filters.clientId)
    if (filters.bank !== 'all') q.set('bank', filters.bank)
    q.set('page', String(page))
    return `${base}?${q.toString()}`
  }
  // Past the last page (a stale link): go to the last page, not an empty one.
  if (list.ok && list.data.count > 0 && pageNo > list.data.pages) redirect(query(list.data.pages))

  const error = !clients.ok ? clients.error : !firm.ok ? firm.error : !list.ok ? list.error : null

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Payments</h1>
        <Link href={`/f/${firmId}/payments/record?from=payments`} className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}>
          Record payment
        </Link>
      </div>

      <form method="get" aria-label="Filter payments" className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-from">From</label>
          <input id="f-from" name="from" type="date" defaultValue={filters.from ?? ''} className={select} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-to">To</label>
          <input id="f-to" name="to" type="date" defaultValue={filters.to ?? ''} className={select} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-client">Client</label>
          <select id="f-client" name="client" defaultValue={filters.clientId ?? ''} className={select}>
            <option value="">All clients</option>
            {clients.ok &&
              clients.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-bank">Show</label>
          <select id="f-bank" name="bank" defaultValue={filters.bank} className={select}>
            <option value="all">All payments</option>
            <option value="unreconciled">Unreconciled only</option>
            <option value="reconciled">Reconciled only</option>
          </select>
        </div>
        <button type="submit" className={`${button} border`}>
          Filter
        </button>
      </form>

      {error || !list.ok || !firm.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm font-medium">
            {list.data.count} {list.data.count === 1 ? 'payment' : 'payments'} ·{' '}
            {formatMoney(list.data.total, firm.data.currency)}
          </p>
          {list.data.rows.length === 0 ? (
            <p className="mt-4 text-sm">No payments in this period.</p>
          ) : (
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  {['Date', 'Invoice', 'Client', 'Method', 'Reference', 'Files', 'Bank'].map((h) => (
                    <th key={h} scope="col" className={th}>
                      {h}
                    </th>
                  ))}
                  <th scope="col" className={`${th} text-right`}>
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((r) => (
                  <tr key={r.paymentId} className="border-b">
                    <td className={td}>{r.paidOn}</td>
                    <td className={td}>
                      <Link href={`/f/${firmId}/invoices/${r.invoiceId}#payments`} className="underline underline-offset-4">
                        {r.invoiceNumber}
                      </Link>
                    </td>
                    <td className={td}>{r.clientName}</td>
                    <td className={td}>{METHOD_LABEL[r.method] ?? r.method}</td>
                    <td className={td}>{r.reference}</td>
                    <td className={td}>{r.fileCount > 0 ? r.fileCount : '—'}</td>
                    <td className={td}>
                      {r.bankAccount ? (
                        <span>Reconciled · {r.bankAccount}</span>
                      ) : (
                        <span className="text-muted-foreground">Not reconciled</span>
                      )}
                    </td>
                    <td className={`${td} text-right`}>{formatMoney(r.amount, firm.data.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {list.data.pages > 1 && (
            <nav aria-label="Pages" className="mt-4 flex items-center gap-4 text-sm">
              {pageNo > 1 && (
                <Link href={query(pageNo - 1)} className="underline underline-offset-4">
                  Previous
                </Link>
              )}
              <span>
                Page {pageNo} of {list.data.pages}
              </span>
              {pageNo < list.data.pages && (
                <Link href={query(pageNo + 1)} className="underline underline-offset-4">
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  )
}
