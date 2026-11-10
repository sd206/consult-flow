import { pnlBreakdownColumns, type PnlParams, type PnlRow } from './pnl'

const MEASURE_HEADER = [
  'Revenue from hours',
  'Fees',
  'Discounts',
  'Revenue',
  'Labour cost',
  'Gross profit',
  'Direct expenses',
  'Overhead',
  'Net profit',
  'Margin %',
  'Invoiced',
  'Collected',
]

export function csvField(value: string, opts: { text: boolean }): string {
  let v = value
  if (opts.text && /^[=+\-@\t\r]/.test(v)) v = `'${v}`
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function labelFor(row: PnlRow, params: PnlParams): string {
  if (row.kind === 'overhead') return 'Unallocated overhead'
  if (row.kind === 'total') return 'Total'
  // Project grouping shows Client and Project as their own columns instead.
  if (params.group === 'project') return ''
  return row.label
}

export function buildPnlCsv(rows: PnlRow[], params: PnlParams): { filename: string; body: string } {
  const cols = pnlBreakdownColumns(params)
  const header = ['Group', ...(cols.client ? ['Client'] : []), ...(cols.project ? ['Project'] : []), ...MEASURE_HEADER]
  const lines = [header.map((h) => csvField(h, { text: true })).join(',')]
  for (const r of rows) {
    const labels = [
      labelFor(r, params),
      ...(cols.client ? [r.clientLabel ?? ''] : []),
      ...(cols.project ? [r.projectLabel ?? ''] : []),
    ]
    const nums = [
      r.revenueHours,
      r.fees,
      r.discounts,
      r.revenue,
      r.labour,
      r.gross,
      r.directExpenses,
      r.overhead,
      r.net,
      r.margin ?? '',
      r.invoiced,
      r.collected,
    ]
    lines.push(
      [...labels.map((l) => csvField(l, { text: true })), ...nums.map((n) => csvField(n, { text: false }))].join(','),
    )
  }
  const filtered = (params.clientIds?.length ?? 0) > 0 || (params.projectIds?.length ?? 0) > 0
  const splitNames = [params.split.client && 'client', params.split.project && 'project'].filter(Boolean)
  const withSplit = params.group !== 'project' && splitNames.length > 0 ? `-with-${splitNames.join('-')}` : ''
  return {
    filename: `pnl-${params.from}-to-${params.to}-by-${params.group}${withSplit}${filtered ? '-filtered' : ''}.csv`,
    body: `\uFEFF${lines.join('\r\n')}\r\n`,
  }
}
