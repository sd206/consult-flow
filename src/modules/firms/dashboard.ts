import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import { fail, ok, type Result } from '@/lib/result'

export type DashboardSummary = {
  consultants: number
  clients: number
  projects: number
  assignments: number
  hasLogo: boolean
}

/**
 * Admin/manager dashboard counts. Authorization is enforced by RLS, not here: a consultant's
 * session cannot read these tables, so the call returns zero counts (not an error). Callers
 * should still only render the result for admin/manager roles.
 */
export async function getDashboardSummary(db: SupabaseClient, firmId: string): Promise<Result<DashboardSummary>> {
  const [consultants, clients, projects, assignments, firm] = await Promise.all([
    db.from('consultants').select('id', { count: 'exact', head: true }).eq('firm_id', firmId).eq('active', true),
    db.from('clients').select('id', { count: 'exact', head: true }).eq('firm_id', firmId).eq('active', true),
    db.from('projects').select('id', { count: 'exact', head: true }).eq('firm_id', firmId).eq('status', 'active'),
    db.from('project_assignments').select('id', { count: 'exact', head: true }).eq('firm_id', firmId),
    db.from('firms').select('logo_path').eq('id', firmId).maybeSingle(),
  ])
  const failed = [consultants, clients, projects, assignments, firm].find((r) => r.error)
  if (failed?.error) return fail(mapDbError(failed.error))
  const logo = (firm.data as { logo_path: string | null } | null)?.logo_path
  return ok({
    consultants: consultants.count ?? 0,
    clients: clients.count ?? 0,
    projects: projects.count ?? 0,
    assignments: assignments.count ?? 0,
    hasLogo: Boolean(logo),
  })
}
