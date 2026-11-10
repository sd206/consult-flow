import type { PnlParams, PnlRow } from './pnl'

const HEADER = [
  'Group',
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
  const lines = [HEADER.map((h) => csvField(h, { text: true })).join(',')]
  for (const r of rows) {
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
    lines.push([csvField(labelFor(r), { text: true }), ...nums.map((n) => csvField(n, { text: false }))].join(','))
  }
  const filtered = (params.clientIds?.length ?? 0) > 0 || (params.projectIds?.length ?? 0) > 0
  return {
    filename: `pnl-${params.from}-to-${params.to}-by-${params.group}${filtered ? '-filtered' : ''}.csv`,
    body: `\uFEFF${lines.join('\r\n')}\r\n`,
  }
}
