import { requireFirmRole } from '@/lib/auth/context'
import { todayIso } from '@/lib/domain/dates'
import { formatMoney } from '@/lib/domain/money'
import { getPnl, parsePnlParams, type PnlRow } from '@/modules/reports/pnl'
import { loadFormOptions } from '../../expenses/form-data'
import { PnlFilters } from './filters'

export const dynamic = 'force-dynamic'

type Sp = Record<string, string | string[] | undefined>

const th = 'py-2 pr-4 font-medium'
const td = 'py-2 pr-4 align-top'

const MONEY_FIELDS = [
  'revenueHours',
  'fees',
  'discounts',
  'revenue',
  'labour',
  'gross',
  'directExpenses',
  'overhead',
  'net',
  'invoiced',
  'collected',
] as const

function queryString(sp: Sp): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x))
    else if (v !== undefined) q.set(k, v)
  }
  return q.toString()
}

function isEmpty(rows: PnlRow[]): boolean {
  return rows.every((r) => MONEY_FIELDS.every((f) => Number(r[f]) === 0))
}

export default async function PnlPage({
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
  const parsed = parsePnlParams(sp, today)
  const opts = await loadFormOptions(db, firmId)
  const currency = opts.currency

  const p = parsed.ok ? parsed.data : null
  const result = p ? await getPnl(db, firmId, p) : null
  const showOverhead = p ? p.group === 'month' || p.group === 'quarter' : false
  const error = !parsed.ok ? parsed.error : result && !result.ok ? result.error : null
  const rows = result && result.ok ? result.data : null

  const money = (v: string) => (
    <span className={v.startsWith('-') ? 'text-red-700 dark:text-red-400' : undefined}>{formatMoney(v, currency)}</span>
  )

  return (
    <div className="max-w-7xl">
      <h1 className="text-2xl font-semibold">Profit &amp; loss</h1>
      <PnlFilters
        firmId={firmId}
        from={p?.from ?? (typeof sp.from === 'string' ? sp.from : `${today.slice(0, 4)}-01-01`)}
        to={p?.to ?? (typeof sp.to === 'string' ? sp.to : today)}
        group={p?.group ?? 'month'}
        clients={opts.clients}
        projects={opts.projects}
        selectedClients={p?.clientIds ?? []}
        selectedProjects={p?.projectIds ?? []}
        exportQuery={queryString(sp)}
      />

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {rows && (
        <>
          {isEmpty(rows) && <p className="mt-4 text-sm">No activity in this period.</p>}
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                {[
                  'Group',
                  'Revenue',
                  'Labour cost',
                  'Gross profit',
                  'Direct expenses',
                  ...(showOverhead ? ['Overhead'] : []),
                  'Net profit',
                  'Margin',
                  'Invoiced',
                  'Collected',
                ].map((h) => (
                  <th key={h} scope="col" className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const label = r.kind === 'overhead' ? 'Unallocated overhead' : r.kind === 'total' ? 'Total' : r.label
                const tip = `Hours ${formatMoney(r.revenueHours, currency)} + fees ${formatMoney(r.fees, currency)} − discounts ${formatMoney(r.discounts, currency)}`
                return (
                  <tr key={`${r.kind}:${r.key}`} className={`border-b ${r.kind === 'total' ? 'font-bold' : ''}`}>
                    <td className={td}>{label}</td>
                    <td className={td} title={tip}>
                      {money(r.revenue)}
                    </td>
                    <td className={td}>{money(r.labour)}</td>
                    <td className={td}>{money(r.gross)}</td>
                    <td className={td}>{money(r.directExpenses)}</td>
                    {showOverhead && <td className={td}>{money(r.overhead)}</td>}
                    <td className={td}>{money(r.net)}</td>
                    <td className={td}>{r.margin === null ? '—' : `${r.margin}%`}</td>
                    <td className={td}>{money(r.invoiced)}</td>
                    <td className={td}>{money(r.collected)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-4 text-sm text-muted-foreground">
            Revenue and labour are counted when the work was done (approved hours only); fees and discounts when
            invoiced. Invoiced and Collected exclude tax.
          </p>
        </>
      )}
    </div>
  )
}
