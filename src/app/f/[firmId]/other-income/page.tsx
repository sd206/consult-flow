import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import { isIsoDate, todayIso } from '@/lib/domain/dates'
import { formatMoney } from '@/lib/domain/money'
import { getFirm } from '@/modules/firms/data'
import { listIncomeCategories } from '@/modules/other-income/categories'
import { listOtherIncome } from '@/modules/other-income/data'
import { AddIncomeForm, IncomeTableRow } from './income-forms'

const th = 'py-2 pr-4 font-medium'
const field = 'h-8 rounded-lg border bg-card px-2 text-sm'

export default async function OtherIncomePage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { firmId } = await params
  const sp = await searchParams
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const today = todayIso()
  const pick = (k: string, d: string) => (typeof sp[k] === 'string' && isIsoDate(sp[k] as string) ? (sp[k] as string) : d)
  const from = pick('from', `${today.slice(0, 4)}-01-01`)
  const to = pick('to', today)
  const [list, cats, firm] = await Promise.all([
    listOtherIncome(db, firmId, { from, to }),
    listIncomeCategories(db, firmId),
    getFirm(db, firmId),
  ])
  const error = !list.ok ? list.error : !cats.ok ? cats.error : !firm.ok ? firm.error : null
  const active = cats.ok ? cats.data.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name })) : []

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Other income</h1>
        <Link href={`/f/${firmId}/other-income/categories`} className="text-sm underline underline-offset-4">
          Categories
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Money received that isn&apos;t an invoice payment, such as interest, refunds or owner contributions.
      </p>

      <AddIncomeForm firmId={firmId} categories={active} today={today} />

      <form method="get" aria-label="Filter other income" className="mt-6 flex flex-wrap items-end gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="oi-from">From</label>
          <input id="oi-from" name="from" type="date" defaultValue={from} className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="oi-to">To</label>
          <input id="oi-to" name="to" type="date" defaultValue={to} className={field} />
        </div>
        <button type="submit" className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm font-medium">
          Filter
        </button>
      </form>

      {error || !list.ok || !firm.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : list.data.rows.length === 0 ? (
        <p className="mt-4 text-sm">No other income in this period.</p>
      ) : (
        <>
          <p className="mt-4 text-sm font-medium">
            {list.data.rows.length} {list.data.rows.length === 1 ? 'entry' : 'entries'} · {formatMoney(list.data.total, firm.data.currency)}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th scope="col" className={th}>Date</th>
                  <th scope="col" className={th}>Received from</th>
                  <th scope="col" className={th}>Category</th>
                  <th scope="col" className={`${th} text-right`}>Amount</th>
                  <th scope="col" className={th}>Notes</th>
                  <th scope="col" className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((r) => (
                  <IncomeTableRow key={r.id} firmId={firmId} row={r} categories={active} currency={firm.data.currency} today={today} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
