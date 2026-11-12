import { csvField } from './pnl-csv'
import type { TxnParams, TxnRow, TxnTotals } from './transactions'

const HEADER = ['Date', 'Transaction', 'Category', 'Amount', 'Notes/Comments']

/** Accountant-ready CSV: ISO dates, plain signed amounts, totals at the end. */
export function buildTxnCsv(rows: TxnRow[], totals: TxnTotals, params: TxnParams): { filename: string; body: string } {
  const line = (cells: [string, string, string, string, string]) =>
    [
      csvField(cells[0], { text: false }),
      csvField(cells[1], { text: true }),
      csvField(cells[2], { text: true }),
      csvField(cells[3], { text: false }),
      csvField(cells[4], { text: true }),
    ].join(',')
  const lines = [HEADER.join(',')]
  for (const r of rows) lines.push(line([r.date, r.transaction, r.category, r.amount, r.notes]))
  lines.push('')
  if (params.kind !== 'out') lines.push(line(['', 'Total money in', '', totals.moneyIn, '']))
  if (params.kind !== 'in') lines.push(line(['', 'Total money out', '', totals.moneyOut, '']))
  if (params.kind === 'all') lines.push(line(['', 'Net', '', totals.net, '']))
  const suffix = params.kind === 'in' ? '-money-in' : params.kind === 'out' ? '-money-out' : ''
  return {
    filename: `transactions-${params.from}-to-${params.to}${suffix}.csv`,
    body: `﻿${lines.join('\r\n')}\r\n`,
  }
}
