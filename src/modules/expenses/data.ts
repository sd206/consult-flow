import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import { fail, ok, type Result } from '@/lib/result'
import { removeOwnerFolder } from '@/modules/attachments/storage'

const EXPENSE_NOT_FOUND = 'Expense not found.'
export const PAGE_SIZE = 50

export type ExpenseFilters = {
  from: string | null
  to: string | null
  categoryId: string | null
  clientId: string | null
  projectId: string | null
  missingReceipt: boolean
}

export type ExpenseRow = {
  id: string
  spentOn: string
  categoryId: string
  categoryName: string
  payee: string
  amount: string
  clientId: string | null
  clientName: string | null
  projectId: string | null
  projectName: string | null
  receiptCount: number
}

export type ExpenseDetail = ExpenseRow & {
  notes: string | null
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number }[]
}

export type ExpenseInput = {
  spentOn: string
  categoryId: string
  payee: string
  amount: string
  clientId: string | null
  projectId: string | null
  notes: string | null
}

type ListDb = {
  id: string
  spent_on: string
  category_id: string
  category_name: string
  payee: string
  amount: string
  client_id: string | null
  client_name: string | null
  project_id: string | null
  project_name: string | null
  receipt_count: number
}

type DetailDb = {
  id: string
  spent_on: string
  category_id: string
  payee: string
  amount: string
  client_id: string | null
  project_id: string | null
  notes: string | null
  expense_categories: { name: string } | null
  clients: { name: string } | null
  projects: { name: string } | null
  attachments: { id: string; file_name: string; mime_type: string; size_bytes: number; created_at: string }[] | null
}

const DETAIL_SELECT =
  'id, spent_on, category_id, payee, amount::text, client_id, project_id, notes, expense_categories(name), clients(name), projects(name), attachments(id, file_name, mime_type, size_bytes, created_at)'

function filterArgs(firmId: string, f: ExpenseFilters) {
  return {
    p_firm: firmId,
    p_from: f.from,
    p_to: f.to,
    p_category: f.categoryId,
    p_client: f.clientId,
    p_project: f.projectId,
    p_missing_receipt: f.missingReceipt,
  }
}

export async function listExpenses(
  db: SupabaseClient,
  firmId: string,
  filters: ExpenseFilters,
  page = 1,
): Promise<Result<{ rows: ExpenseRow[]; total: string; count: number; pages: number }>> {
  const pageNo = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
  const args = filterArgs(firmId, filters)
  const [totals, list] = await Promise.all([
    db.rpc('expense_totals', args),
    db.rpc('list_expenses', { ...args, p_limit: PAGE_SIZE, p_offset: (pageNo - 1) * PAGE_SIZE }),
  ])
  if (totals.error) return fail(mapDbError(totals.error))
  if (list.error) return fail(mapDbError(list.error))
  const t = (totals.data as { total: string; expense_count: number }[] | null)?.[0]
  if (!t) return fail(mapDbError(null))
  const rows = ((list.data ?? []) as ListDb[]).map((r) => ({
    id: r.id,
    spentOn: r.spent_on,
    categoryId: r.category_id,
    categoryName: r.category_name,
    payee: r.payee,
    amount: r.amount,
    clientId: r.client_id,
    clientName: r.client_name,
    projectId: r.project_id,
    projectName: r.project_name,
    receiptCount: r.receipt_count,
  }))
  return ok({ rows, total: t.total, count: t.expense_count, pages: Math.max(1, Math.ceil(t.expense_count / PAGE_SIZE)) })
}

export async function getExpense(db: SupabaseClient, firmId: string, id: string): Promise<Result<ExpenseDetail>> {
  const { data, error } = await db.from('expenses').select(DETAIL_SELECT).eq('firm_id', firmId).eq('id', id).maybeSingle()
  if (error) return fail(mapDbError(error))
  if (!data) return fail(EXPENSE_NOT_FOUND)
  const e = data as unknown as DetailDb
  const attachments = [...(e.attachments ?? [])]
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
    .map((a) => ({ id: a.id, fileName: a.file_name, mimeType: a.mime_type, sizeBytes: a.size_bytes }))
  return ok({
    id: e.id,
    spentOn: e.spent_on,
    categoryId: e.category_id,
    categoryName: e.expense_categories?.name ?? '',
    payee: e.payee,
    amount: e.amount,
    clientId: e.client_id,
    clientName: e.clients?.name ?? null,
    projectId: e.project_id,
    projectName: e.projects?.name ?? null,
    receiptCount: attachments.length,
    notes: e.notes,
    attachments,
  })
}

function columns(input: ExpenseInput) {
  return {
    spent_on: input.spentOn,
    category_id: input.categoryId,
    payee: input.payee,
    amount: input.amount,
    client_id: input.clientId,
    project_id: input.projectId,
    notes: input.notes,
  }
}

export async function createExpense(db: SupabaseClient, firmId: string, input: ExpenseInput): Promise<Result<{ id: string }>> {
  const { data, error } = await db
    .from('expenses')
    .insert({ firm_id: firmId, ...columns(input) })
    .select('id')
    .single()
  if (error || !data) return fail(mapDbError(error))
  return ok({ id: (data as { id: string }).id })
}

export async function updateExpense(db: SupabaseClient, firmId: string, id: string, input: ExpenseInput): Promise<Result<void>> {
  const { data, error } = await db.from('expenses').update(columns(input)).eq('firm_id', firmId).eq('id', id).select('id')
  if (error) return fail(mapDbError(error))
  return data && data.length > 0 ? ok(undefined) : fail(EXPENSE_NOT_FOUND)
}

/** Deletes the expense (RLS; its attachment rows cascade), then everything in its folder. Cleanup failure is logged only. */
export async function deleteExpense(db: SupabaseClient, firmId: string, id: string): Promise<Result<void>> {
  const { data, error } = await db.from('expenses').delete().eq('firm_id', firmId).eq('id', id).select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail(EXPENSE_NOT_FOUND)
  try {
    await removeOwnerFolder(firmId, { kind: 'expense', id })
  } catch (e) {
    console.error('expense file cleanup failed', e)
  }
  return ok(undefined)
}
