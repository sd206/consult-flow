import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import { fail, ok, type Result } from '@/lib/result'

const NOT_FOUND = 'Category not found.'

export type CategoryRow = { id: string; name: string; active: boolean; incomeCount: number }

type CategoryDb = { id: string; name: string; active: boolean; other_income: { count: number }[] | null }

export async function listCategories(
  db: SupabaseClient,
  firmId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<Result<CategoryRow[]>> {
  let query = db.from('other_income_categories').select('id, name, active, other_income(count)').eq('firm_id', firmId)
  if (opts.activeOnly) query = query.eq('active', true)
  const { data, error } = await query
  if (error) return fail(mapDbError(error))
  const rows = ((data ?? []) as unknown as CategoryDb[]).map((c) => ({
    id: c.id,
    name: c.name,
    active: c.active,
    incomeCount: c.other_income?.[0]?.count ?? 0,
  }))
  rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  return ok(rows)
}

export async function createCategory(db: SupabaseClient, firmId: string, name: string): Promise<Result<{ id: string }>> {
  const { data, error } = await db.from('other_income_categories').insert({ firm_id: firmId, name }).select('id').single()
  if (error || !data) return fail(mapDbError(error))
  return ok({ id: (data as { id: string }).id })
}

async function updateCategory(
  db: SupabaseClient,
  firmId: string,
  id: string,
  patch: { name?: string; active?: boolean },
): Promise<Result<void>> {
  const { data, error } = await db.from('other_income_categories').update(patch).eq('firm_id', firmId).eq('id', id).select('id')
  if (error) return fail(mapDbError(error))
  return data && data.length > 0 ? ok(undefined) : fail(NOT_FOUND)
}

export function renameCategory(db: SupabaseClient, firmId: string, id: string, name: string): Promise<Result<void>> {
  return updateCategory(db, firmId, id, { name })
}

export function setCategoryActive(db: SupabaseClient, firmId: string, id: string, active: boolean): Promise<Result<void>> {
  return updateCategory(db, firmId, id, { active })
}

export async function deleteCategory(db: SupabaseClient, firmId: string, id: string): Promise<Result<void>> {
  const { data, error } = await db.from('other_income_categories').delete().eq('firm_id', firmId).eq('id', id).select('id')
  if (error) return fail(mapDbError(error))
  return data && data.length > 0 ? ok(undefined) : fail(NOT_FOUND)
}

/** Categories for the bank review panel and the other income form. */
export const listIncomeCategories = listCategories
