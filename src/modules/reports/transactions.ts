import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import { isIsoDate } from '@/lib/domain/dates'
import { fail, ok, type Result } from '@/lib/result'

export type TxnKind = 'all' | 'in' | 'out'

export type TxnParams = { from: string; to: string; kind: TxnKind }

export type TxnRow = {
  kind: 'payment' | 'expense'
  id: string
  date: string
  transaction: string
  category: string
  /** Signed: payments positive, expenses negative, two decimals. */
  amount: string
  notes: string
}

export type TxnTotals = { moneyIn: string; moneyOut: string; net: string; count: number }

const RANGE_MESSAGE = 'Choose an end date on or after the start date, within 3 years.'
const KINDS: readonly string[] = ['all', 'in', 'out']

export const METHOD_LABEL: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  check: 'Check',
  card: 'Card',
  cash: 'Cash',
  other: 'Other',
}

type Search = Record<string, string | string[] | undefined>

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

function plusThreeYears(from: string): string {
  const y = String(Number(from.slice(0, 4)) + 3).padStart(4, '0')
  const candidate = `${y}-${from.slice(5)}`
  return isIsoDate(candidate) ? candidate : `${y}-02-28`
}

export function parseTxnParams(search: Search, today: string): Result<TxnParams> {
  const from = first(search.from) || `${today.slice(0, 4)}-01-01`
  const to = first(search.to) || today
  if (!isIsoDate(from) || !isIsoDate(to) || to < from || to > plusThreeYears(from)) return fail(RANGE_MESSAGE)
  const kind = first(search.kind) || 'all'
  return ok({ from, to, kind: (KINDS.includes(kind) ? kind : 'all') as TxnKind })
}

type TxnDb = {
  kind: 'payment' | 'expense'
  id: string
  txn_date: string
  client_name: string | null
  project_name: string | null
  invoice_number: string | null
  method: string | null
  reference: string | null
  payee: string | null
  category: string
  amount: string
  notes: string | null
}

/** "1234.5" → 123450 cents, as an exact integer (numeric(12,2) fits well within 2^53). */
function toCents(v: string): number {
  const neg = v.startsWith('-')
  const [whole, frac = ''] = (neg ? v.slice(1) : v).split('.')
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2))
  return neg ? -cents : cents
}

function fromCents(c: number): string {
  const abs = Math.abs(c)
  return `${c < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

export function describeTxn(r: TxnDb): string {
  if (r.kind === 'payment') {
    const extra = [r.method ? (METHOD_LABEL[r.method] ?? r.method) : null, r.reference ? `ref ${r.reference}` : null]
      .filter(Boolean)
      .join(', ')
    const inv = r.invoice_number ? `, ${r.invoice_number}` : ''
    return `Payment – ${r.client_name ?? ''}${inv}${extra ? ` (${extra})` : ''}`
  }
  const work = [r.client_name, r.project_name].filter(Boolean).join(' / ')
  return `Expense – ${r.payee ?? ''}${work ? ` (${work})` : ''}`
}

export function toTxnRow(r: TxnDb): TxnRow {
  const cents = toCents(r.amount)
  return {
    kind: r.kind,
    id: r.id,
    date: r.txn_date,
    transaction: describeTxn(r),
    category: r.category,
    amount: fromCents(r.kind === 'expense' ? -cents : cents),
    notes: r.notes ?? '',
  }
}

export function txnTotals(rows: TxnRow[]): TxnTotals {
  let moneyIn = 0
  let moneyOut = 0
  for (const r of rows) {
    const c = toCents(r.amount)
    if (r.kind === 'payment') moneyIn += c
    else moneyOut += c
  }
  return { moneyIn: fromCents(moneyIn), moneyOut: fromCents(moneyOut), net: fromCents(moneyIn + moneyOut), count: rows.length }
}

export async function getTransactions(
  db: SupabaseClient,
  firmId: string,
  params: TxnParams,
): Promise<Result<{ rows: TxnRow[]; totals: TxnTotals }>> {
  const { data, error } = await db.rpc('transactions_report', {
    p_firm: firmId,
    p_from: params.from,
    p_to: params.to,
    p_kind: params.kind,
  })
  if (error) return fail(mapDbError(error))
  const rows = ((data ?? []) as TxnDb[]).map(toTxnRow)
  return ok({ rows, totals: txnTotals(rows) })
}
