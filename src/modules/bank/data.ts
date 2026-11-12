import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import { fail, ok, type Result } from '@/lib/result'
import { cleanDescription } from './clean'
import { dedupeKeys } from './dedupe'
import { parseStatement } from './parse'
import type { AccountInput } from './schemas'
import { rankInvoices, type InvoiceCandidate } from './suggest'
import type { CsvMapping, ParseError } from './types'

export type BankAccount = {
  id: string
  name: string
  kind: 'bank' | 'credit_card'
  last4: string | null
  csvMapping: CsvMapping | null
  active: boolean
  newCount: number
}

export type LineStatus = 'new' | 'done' | 'ignored'

export type BankLine = {
  id: string
  postedOn: string
  amount: string
  description: string
  bankRef: string | null
  status: LineStatus
  ignoreReason: string | null
  linkKind: 'payment' | 'expense' | 'other_income' | null
  linkedLabel: string | null
  suggestedCategoryId: string | null
}

export type Candidates = {
  invoices: InvoiceCandidate[]
  payments: { id: string; paid_on: string; amount: string; invoice_number: string; client_name: string }[]
  expenses: { id: string; spent_on: string; amount: string; payee: string }[]
}

export type ImportOutcome = { inserted: number; duplicates: number; errors: ParseError[] }

type AccountDb = {
  id: string
  name: string
  kind: 'bank' | 'credit_card'
  last4: string | null
  csv_mapping: CsvMapping | null
  active: boolean
}

const ACCOUNT_COLS = 'id, name, kind, last4, csv_mapping, active'

function toAccount(r: AccountDb, newCount = 0): BankAccount {
  return { id: r.id, name: r.name, kind: r.kind, last4: r.last4, csvMapping: r.csv_mapping, active: r.active, newCount }
}

export async function listAccounts(db: SupabaseClient, firmId: string): Promise<Result<BankAccount[]>> {
  const [accts, lines] = await Promise.all([
    db.from('bank_accounts').select(ACCOUNT_COLS).eq('firm_id', firmId).order('active', { ascending: false }).order('name'),
    db.from('bank_lines').select('account_id').eq('firm_id', firmId).eq('status', 'new'),
  ])
  if (accts.error) return fail(mapDbError(accts.error))
  if (lines.error) return fail(mapDbError(lines.error))
  const counts = new Map<string, number>()
  for (const l of (lines.data ?? []) as { account_id: string }[]) counts.set(l.account_id, (counts.get(l.account_id) ?? 0) + 1)
  return ok(((accts.data ?? []) as AccountDb[]).map((a) => toAccount(a, counts.get(a.id) ?? 0)))
}

export async function getAccount(db: SupabaseClient, firmId: string, id: string): Promise<Result<BankAccount>> {
  const { data, error } = await db.from('bank_accounts').select(ACCOUNT_COLS).eq('firm_id', firmId).eq('id', id).maybeSingle()
  if (error) return fail(mapDbError(error))
  if (!data) return fail('Bank account not found.')
  return ok(toAccount(data as AccountDb))
}

export async function createAccount(db: SupabaseClient, firmId: string, input: AccountInput): Promise<Result<{ id: string }>> {
  const { data, error } = await db
    .from('bank_accounts')
    .insert({ firm_id: firmId, name: input.name, kind: input.kind, last4: input.last4 })
    .select('id')
    .single()
  if (error || !data) return fail(mapDbError(error))
  return ok({ id: (data as { id: string }).id })
}

export async function updateAccount(
  db: SupabaseClient,
  firmId: string,
  id: string,
  input: AccountInput & { active?: boolean },
): Promise<Result<void>> {
  const { data, error } = await db
    .from('bank_accounts')
    .update({ name: input.name, kind: input.kind, last4: input.last4, ...(input.active === undefined ? {} : { active: input.active }) })
    .eq('firm_id', firmId)
    .eq('id', id)
    .select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail('Bank account not found.')
  return ok(undefined)
}

export async function setAccountActive(db: SupabaseClient, firmId: string, id: string, active: boolean): Promise<Result<void>> {
  const { data, error } = await db.from('bank_accounts').update({ active }).eq('firm_id', firmId).eq('id', id).select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail('Bank account not found.')
  return ok(undefined)
}

export async function saveCsvMapping(db: SupabaseClient, accountId: string, mapping: CsvMapping): Promise<Result<void>> {
  const { error } = await db.rpc('save_csv_mapping', { p_account: accountId, p_mapping: mapping })
  return error ? fail(mapDbError(error)) : ok(undefined)
}

/** Parses the file, computes keys and stores the new lines. */
export async function importStatement(
  db: SupabaseClient,
  accountId: string,
  fileName: string,
  text: string,
  mapping: CsvMapping | null,
): Promise<Result<ImportOutcome>> {
  const parsed = parseStatement(fileName, text, mapping)
  if (!parsed.ok) return parsed
  const { lines, errors, format } = parsed.data
  if (lines.length === 0) return ok({ inserted: 0, duplicates: 0, errors })
  const keys = dedupeKeys(lines)
  const payload = lines.map((l, i) => ({
    posted_on: l.postedOn,
    amount: l.amount,
    description: l.description,
    clean_description: cleanDescription(l.description),
    bank_ref: l.bankRef,
    dedupe_key: keys[i],
  }))
  const { data, error } = await db.rpc('import_bank_lines', {
    p_account: accountId,
    p_file_name: fileName,
    p_format: format,
    p_lines: payload,
  })
  if (error) return fail(mapDbError(error))
  const row = (data as { inserted: number; duplicates: number }[] | null)?.[0]
  if (!row) return fail(mapDbError(null))
  return ok({ inserted: row.inserted, duplicates: row.duplicates, errors })
}

type LineDb = {
  id: string
  posted_on: string
  amount: string
  description: string
  bank_ref: string | null
  status: LineStatus
  ignore_reason: string | null
  payment_id: string | null
  expense_id: string | null
  other_income_id: string | null
  linked_label: string | null
  suggested_category_id: string | null
}

export async function listLines(db: SupabaseClient, accountId: string, status: LineStatus): Promise<Result<BankLine[]>> {
  const { data, error } = await db.rpc('list_bank_lines', { p_account: accountId, p_status: status })
  if (error) return fail(mapDbError(error))
  return ok(
    ((data ?? []) as LineDb[]).map((r) => ({
      id: r.id,
      postedOn: r.posted_on,
      amount: r.amount,
      description: r.description,
      bankRef: r.bank_ref,
      status: r.status,
      ignoreReason: r.ignore_reason,
      linkKind: r.payment_id ? 'payment' : r.expense_id ? 'expense' : r.other_income_id ? 'other_income' : null,
      linkedLabel: r.linked_label,
      suggestedCategoryId: r.suggested_category_id,
    })),
  )
}

export async function getCandidates(
  db: SupabaseClient,
  line: { id: string; description: string; amount: string },
): Promise<Result<Candidates>> {
  const { data, error } = await db.rpc('bank_match_candidates', { p_line: line.id })
  if (error) return fail(mapDbError(error))
  const c = data as Candidates
  return ok({ ...c, invoices: rankInvoices(line.description, c.invoices, line.amount) })
}

async function rpcId(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Result<string>> {
  const { data, error } = await db.rpc(fn, args)
  if (error) return fail(mapDbError(error))
  return ok(data as string)
}

export function confirmPayment(db: SupabaseClient, lineId: string, invoiceId: string, notes: string | null) {
  return rpcId(db, 'confirm_bank_line_payment', { p_line: lineId, p_invoice: invoiceId, p_notes: notes })
}

export function confirmExpense(
  db: SupabaseClient,
  lineId: string,
  input: { payee: string; categoryId: string; clientId: string | null; projectId: string | null; notes: string | null },
) {
  return rpcId(db, 'confirm_bank_line_expense', {
    p_line: lineId,
    p_payee: input.payee,
    p_category: input.categoryId,
    p_client: input.clientId,
    p_project: input.projectId,
    p_notes: input.notes,
  })
}

export function confirmOtherIncome(
  db: SupabaseClient,
  lineId: string,
  input: { source: string; categoryId: string; notes: string | null },
) {
  return rpcId(db, 'confirm_bank_line_other_income', {
    p_line: lineId,
    p_category: input.categoryId,
    p_source: input.source,
    p_notes: input.notes,
  })
}

export async function linkLine(
  db: SupabaseClient,
  lineId: string,
  target: { paymentId: string } | { expenseId: string },
): Promise<Result<void>> {
  const { error } = await db.rpc('link_bank_line', {
    p_line: lineId,
    p_payment: 'paymentId' in target ? target.paymentId : null,
    p_expense: 'expenseId' in target ? target.expenseId : null,
  })
  return error ? fail(mapDbError(error)) : ok(undefined)
}

export async function ignoreLines(db: SupabaseClient, lineIds: string[], reason: string | null): Promise<Result<number>> {
  const { data, error } = await db.rpc('ignore_bank_lines', { p_lines: lineIds, p_reason: reason })
  if (error) return fail(mapDbError(error))
  return ok(data as number)
}

export async function resetLine(db: SupabaseClient, lineId: string): Promise<Result<void>> {
  const { error } = await db.rpc('reset_bank_line', { p_line: lineId })
  return error ? fail(mapDbError(error)) : ok(undefined)
}

export async function markDuplicates(
  db: SupabaseClient,
  lineIds: string[],
): Promise<Result<{ matched: number; ignored: number; skipped: number }>> {
  const { data, error } = await db.rpc('mark_bank_lines_duplicate', { p_lines: lineIds })
  if (error) return fail(mapDbError(error))
  const row = (data as { matched: number; ignored: number; skipped: number }[] | null)?.[0]
  return row ? ok(row) : fail(mapDbError(null))
}
