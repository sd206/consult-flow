import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import { fail, ok, type Result } from '@/lib/result'

export type IncomeRow = {
  id: string
  receivedOn: string
  categoryId: string
  categoryName: string
  source: string
  amount: string
  notes: string | null
  fromBank: boolean
}

export type IncomeInput = { receivedOn: string; categoryId: string; source: string; amount: string; notes: string | null }

type IncomeDb = {
  id: string
  received_on: string
  category_id: string
  source: string
  amount: string
  notes: string | null
  other_income_categories: { name: string } | null
  bank_lines: { id: string }[] | null
}

const NOT_FOUND = 'Entry not found.'

export async function listOtherIncome(
  db: SupabaseClient,
  firmId: string,
  range: { from: string; to: string },
): Promise<Result<{ rows: IncomeRow[]; total: string }>> {
  const { data, error } = await db
    .from('other_income')
    .select('id, received_on, category_id, source, amount::text, notes, other_income_categories(name), bank_lines(id)')
    .eq('firm_id', firmId)
    .gte('received_on', range.from)
    .lte('received_on', range.to)
    .order('received_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) return fail(mapDbError(error))
  const rows = ((data ?? []) as unknown as IncomeDb[]).map((r) => ({
    id: r.id,
    receivedOn: r.received_on,
    categoryId: r.category_id,
    categoryName: r.other_income_categories?.name ?? '',
    source: r.source,
    amount: r.amount,
    notes: r.notes,
    fromBank: (r.bank_lines?.length ?? 0) > 0,
  }))
  const cents = rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0)
  return ok({ rows, total: (cents / 100).toFixed(2) })
}

function columns(input: IncomeInput) {
  return {
    received_on: input.receivedOn,
    category_id: input.categoryId,
    source: input.source,
    amount: input.amount,
    notes: input.notes,
  }
}

export async function createOtherIncome(db: SupabaseClient, firmId: string, input: IncomeInput): Promise<Result<void>> {
  const { error } = await db.from('other_income').insert({ firm_id: firmId, ...columns(input) })
  return error ? fail(mapDbError(error)) : ok(undefined)
}

export async function updateOtherIncome(db: SupabaseClient, firmId: string, id: string, input: IncomeInput): Promise<Result<void>> {
  const { data, error } = await db.from('other_income').update(columns(input)).eq('firm_id', firmId).eq('id', id).select('id')
  if (error) return fail(mapDbError(error))
  return data && data.length > 0 ? ok(undefined) : fail(NOT_FOUND)
}

export async function deleteOtherIncome(db: SupabaseClient, firmId: string, id: string): Promise<Result<void>> {
  const { data, error } = await db.from('other_income').delete().eq('firm_id', firmId).eq('id', id).select('id')
  if (error) return fail(mapDbError(error))
  return data && data.length > 0 ? ok(undefined) : fail(NOT_FOUND)
}
