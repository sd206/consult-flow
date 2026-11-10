import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import type { FirmRole } from '@/lib/db-types'
import { fail, ok, type Result } from '@/lib/result'
import { getOutstandingSummary } from '@/modules/receivables/data'

const NO_TOTALS = { outstanding: '0.00', overdue: '0.00', overdueCount: 0 }

export type DashboardSummary = {
  consultants: number
  clients: number
  projects: number
  assignments: number
  hasLogo: boolean
  awaitingApproval: number
  outstanding: string
  overdue: string
  overdueCount: number
}

/**
 * Admin/manager dashboard counts. Authorization is enforced by RLS, not here: a consultant's
 * session cannot read these tables, so the counts come back as zero (not an error), and the
 * outstanding summary is not asked for at all. Callers should still only render the result
 * for admin/manager roles.
 */
export async function getDashboardSummary(
  db: SupabaseClient,
  firmId: string,
  role: FirmRole,
): Promise<Result<DashboardSummary>> {
  const [consultants, clients, projects, assignments, firm, awaiting, summary] = await Promise.all([
    db.from('consultants').select('id', { count: 'exact', head: true }).eq('firm_id', firmId).eq('active', true),
    db.from('clients').select('id', { count: 'exact', head: true }).eq('firm_id', firmId).eq('active', true),
    db.from('projects').select('id', { count: 'exact', head: true }).eq('firm_id', firmId).eq('status', 'active'),
    db.from('project_assignments').select('id', { count: 'exact', head: true }).eq('firm_id', firmId),
    db.from('firms').select('logo_path').eq('id', firmId).maybeSingle(),
    db.from('timesheets').select('id', { count: 'exact', head: true }).eq('firm_id', firmId).eq('status', 'submitted'),
    role === 'consultant' ? Promise.resolve(ok(NO_TOTALS)) : getOutstandingSummary(db, firmId),
  ])
  const failed = [consultants, clients, projects, assignments, firm, awaiting].find((r) => r.error)
  if (failed?.error) return fail(mapDbError(failed.error))
  if (!summary.ok) return fail(summary.error)
  const totals = summary.data
  const logo = (firm.data as { logo_path: string | null } | null)?.logo_path
  return ok({
    consultants: consultants.count ?? 0,
    clients: clients.count ?? 0,
    projects: projects.count ?? 0,
    assignments: assignments.count ?? 0,
    hasLogo: Boolean(logo),
    awaitingApproval: awaiting.count ?? 0,
    outstanding: totals.outstanding,
    overdue: totals.overdue,
    overdueCount: totals.overdueCount,
  })
}
