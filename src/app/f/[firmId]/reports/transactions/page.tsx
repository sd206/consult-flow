import { requireFirmRole } from '@/lib/auth/context'
import { todayIso } from '@/lib/domain/dates'
import { formatMoney } from '@/lib/domain/money'
import { getFirm } from '@/modules/firms/data'
import { getTransactions, parseTxnParams } from '@/modules/reports/transactions'

export const dynamic = 'force-dynamic'

type Sp = Record<string, string | string[] | undefined>

const th = 'py-2 pr-4 font-medium'
const td = 'py-2 pr-4 align-top'
const field = 'h-8 rounded-lg border bg-card px-2 text-sm'
const button = 'inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium'

export default async function TransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>
  searchParams: Promise<Sp>
}) {
  const { firmId } = await params
  const sp = await searchParams
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const today = todayIso()
  const parsed = parseTxnParams(sp, today)
  const p = parsed.ok ? parsed.data : null
  const [result, firm] = await Promise.all([p ? getTransactions(db, firmId, p) : null, getFirm(db, firmId)])

  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined)
  const from = p?.from ?? str('from') ?? `${today.slice(0, 4)}-01-01`
  const to = p?.to ?? str('to') ?? today
  const kind = p?.kind ?? 'all'
  const error = !parsed.ok ? parsed.error : !firm.ok ? firm.error : result && !result.ok ? result.error : null
  const currency = firm.ok ? firm.data.currency : 'USD'
  const csvHref = p ? `/f/${firmId}/reports/transactions/csv?${new URLSearchParams(p).toString()}` : null

  const money = (v: string) => (
    <span className={v.startsWith('-') ? 'text-red-700 dark:text-red-400' : undefined}>{formatMoney(v, currency)}</span>
  )

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold">Transactions</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Payments received, other income and expenses, for your accountant. Download the CSV to share it.
      </p>

      <form method="get" aria-label="Filter transactions" className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="t-from">From</label>
          <input id="t-from" name="from" type="date" required defaultValue={from} className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="t-to">To</label>
          <input id="t-to" name="to" type="date" required defaultValue={to} className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="t-kind">Type</label>
          <select id="t-kind" name="kind" defaultValue={kind} className={field}>
            <option value="all">All</option>
            <option value="in">Money in (payments and other income)</option>
            <option value="out">Money out (expenses)</option>
          </select>
        </div>
        <button type="submit" className={`${button} border`}>
          Show report
        </button>
        {csvHref && !error && (
          <a href={csvHref} className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}>
            Download CSV
          </a>
        )}
      </form>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : result && result.ok ? (
        result.data.rows.length === 0 ? (
          <p className="mt-6 text-sm">No transactions in this period.</p>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Transactions from {from} to {to}
              </caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className={th}>Date</th>
                  <th scope="col" className={th}>Transaction</th>
                  <th scope="col" className={th}>Category</th>
                  <th scope="col" className={`${th} text-right`}>Amount</th>
                  <th scope="col" className={th}>Notes/Comments</th>
                </tr>
              </thead>
              <tbody>
                {result.data.rows.map((r) => (
                  <tr key={`${r.kind}:${r.id}`} className="border-b">
                    <td className={`${td} whitespace-nowrap`}>{r.date}</td>
                    <th scope="row" className={`${td} font-normal`}>{r.transaction}</th>
                    <td className={td}>{r.category}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>{money(r.amount)}</td>
                    <td className={`${td} whitespace-pre-line`}>{r.notes}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="font-semibold">
                {kind !== 'out' && (
                  <tr>
                    <th scope="row" colSpan={3} className={`${td} text-left`}>Total money in</th>
                    <td className={`${td} text-right`}>{money(result.data.totals.moneyIn)}</td>
                    <td />
                  </tr>
                )}
                {kind !== 'in' && (
                  <tr>
                    <th scope="row" colSpan={3} className={`${td} text-left`}>Total money out</th>
                    <td className={`${td} text-right`}>{money(result.data.totals.moneyOut)}</td>
                    <td />
                  </tr>
                )}
                {kind === 'all' && (
                  <tr className="border-t">
                    <th scope="row" colSpan={3} className={`${td} text-left`}>Net</th>
                    <td className={`${td} text-right`}>{money(result.data.totals.net)}</td>
                    <td />
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )
      ) : null}
    </div>
  )
}
