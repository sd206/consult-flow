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

function labelFor(row: PnlRow): string {
  if (row.kind === 'overhead') return 'Unallocated overhead'
  if (row.kind === 'total') return 'Total'
  return row.label
}

export function buildPnlCsv(rows: PnlRow[], params: PnlParams): { filename: string; body: string } {
  const cols = pnlBreakdownColumns(params)
  // Project grouping has no separate Group column: Client and Project are the row labels,
  // and the Total / Unallocated overhead labels go in the Client column.
  const byProject = params.group === 'project'
  const header = byProject
    ? ['Client', 'Project', ...MEASURE_HEADER]
    : ['Group', ...(cols.client ? ['Client'] : []), ...(cols.project ? ['Project'] : []), ...MEASURE_HEADER]
  const lines = [header.map((h) => csvField(h, { text: true })).join(',')]
  for (const r of rows) {
    const labels = byProject
      ? [r.kind === 'group' ? (r.clientLabel ?? '') : labelFor(r), r.kind === 'group' ? (r.projectLabel ?? '') : '']
      : [
          labelFor(r),
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
