import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireFirmRole } from '@/lib/auth/context'
import { isIsoDate, todayIso } from '@/lib/domain/dates'
import { formatMoney } from '@/lib/domain/money'
import { listExpenses, type ExpenseFilters } from '@/modules/expenses/data'
import { loadFormOptions } from './form-data'

const th = 'py-2 pr-4 font-medium'
const td = 'py-2 pr-4 align-top'
const select = 'h-8 rounded-lg border bg-card px-2 text-sm'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const button = 'inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium'

type Sp = Record<string, string | string[] | undefined>

function one(sp: Sp, key: string): string | undefined {
  const v = sp[key]
  return typeof v === 'string' ? v : undefined
}

function idParam(sp: Sp, key: string): string | null {
  const v = one(sp, key)
  return v && UUID_RE.test(v) ? v : null
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

export default async function ExpensesPage({
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
  const filters: ExpenseFilters = {
    from: dateParam(sp, 'from', first),
    to: dateParam(sp, 'to', last),
    categoryId: idParam(sp, 'category'),
    clientId: idParam(sp, 'client'),
    projectId: idParam(sp, 'project'),
    missingReceipt: one(sp, 'noReceipt') === '1',
  }
  const pageNo = Math.max(1, Math.floor(Number(one(sp, 'page'))) || 1)
  const [list, opts] = await Promise.all([listExpenses(db, firmId, filters, pageNo), loadFormOptions(db, firmId)])
  const base = `/f/${firmId}/expenses`
  const categoryById = new Map(opts.categories.map((c) => [c.id, c]))

  const query = (page: number) => {
    const q = new URLSearchParams()
    q.set('from', filters.from ?? '')
    q.set('to', filters.to ?? '')
    if (filters.categoryId) q.set('category', filters.categoryId)
    if (filters.clientId) q.set('client', filters.clientId)
    if (filters.projectId) q.set('project', filters.projectId)
    if (filters.missingReceipt) q.set('noReceipt', '1')
    q.set('page', String(page))
    return `${base}?${q.toString()}`
  }
  // Past the last page (e.g. after deletes or a stale link): go to the last page, not an empty one.
  if (list.ok && list.data.count > 0 && pageNo > list.data.pages) redirect(query(list.data.pages))

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Expenses</h1>
        <div className="flex items-center gap-3">
          <Link href={`${base}/categories`} className={`${button} border`}>
            Categories
          </Link>
          <Link href={`${base}/new`} className={`${button} bg-primary text-primary-foreground hover:bg-primary-hover`}>
            New expense
          </Link>
        </div>
      </div>

      <form method="get" aria-label="Filter expenses" className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-from">From</label>
          <input id="f-from" name="from" type="date" defaultValue={filters.from ?? ''} className={select} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-to">To</label>
          <input id="f-to" name="to" type="date" defaultValue={filters.to ?? ''} className={select} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-category">Category</label>
          <select id="f-category" name="category" defaultValue={filters.categoryId ?? ''} className={select}>
            <option value="">All categories</option>
            {opts.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.active ? c.name : `${c.name} (retired)`}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-client">Client</label>
          <select id="f-client" name="client" defaultValue={filters.clientId ?? ''} className={select}>
            <option value="">All clients</option>
            {opts.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-project">Project</label>
          <select id="f-project" name="project" defaultValue={filters.projectId ?? ''} className={select}>
            <option value="">All projects</option>
            {opts.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.clientName}: {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          <input id="f-noreceipt" name="noReceipt" type="checkbox" value="1" defaultChecked={filters.missingReceipt} />
          <label htmlFor="f-noreceipt">No receipt only</label>
        </div>
        <button type="submit" className={`${button} border`}>
          Filter
        </button>
      </form>

      {!list.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {list.error}
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm font-medium">
            {list.data.count} {list.data.count === 1 ? 'expense' : 'expenses'} · {formatMoney(list.data.total, opts.currency)}
          </p>
          {list.data.rows.length === 0 ? (
            <p className="mt-4 text-sm">No expenses match these filters.</p>
          ) : (
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  {['Date', 'Payee', 'Category', 'Client', 'Project', 'Amount', 'Receipt'].map((h) => (
                    <th key={h} scope="col" className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((r) => {
                  const cat = categoryById.get(r.categoryId)
                  return (
                    <tr key={r.id} className="border-b">
                      <td className={td}>{r.spentOn}</td>
                      <td className={td}>
                        <Link href={`${base}/${r.id}`} className="underline underline-offset-4">
                          {r.payee}
                        </Link>
                      </td>
                      <td className={td}>
                        {r.categoryName}
                        {cat && !cat.active ? ' (retired)' : ''}
                      </td>
                      <td className={td}>{r.clientName}</td>
                      <td className={td}>{r.projectName}</td>
                      <td className={td}>{formatMoney(r.amount, opts.currency)}</td>
                      <td className={td}>
                        {r.receiptCount > 0 ? (
                          r.receiptCount
                        ) : (
                          <span className="font-medium text-amber-700 dark:text-amber-400">No receipt</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
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
