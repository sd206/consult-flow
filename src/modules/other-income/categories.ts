import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import { fail, ok, type Result } from '@/lib/result'

export type IncomeCategory = { id: string; name: string; active: boolean; incomeCount: number }

export async function listIncomeCategories(db: SupabaseClient, firmId: string): Promise<Result<IncomeCategory[]>> {
  const [cats, used] = await Promise.all([
    db.from('other_income_categories').select('id, name, active').eq('firm_id', firmId).order('name'),
    db.from('other_income').select('category_id').eq('firm_id', firmId),
  ])
  if (cats.error) return fail(mapDbError(cats.error))
  if (used.error) return fail(mapDbError(used.error))
  const counts = new Map<string, number>()
  for (const r of (used.data ?? []) as { category_id: string }[]) counts.set(r.category_id, (counts.get(r.category_id) ?? 0) + 1)
  return ok(
    ((cats.data ?? []) as { id: string; name: string; active: boolean }[]).map((c) => ({
      ...c,
      incomeCount: counts.get(c.id) ?? 0,
    })),
  )
}
