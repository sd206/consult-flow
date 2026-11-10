import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import { isIsoDate } from '@/lib/domain/dates'
import { fail, ok, type Result } from '@/lib/result'

export type PnlGroup = 'month' | 'quarter' | 'client' | 'project'

export type PnlParams = {
  from: string
  to: string
  group: PnlGroup
  clientIds: string[] | null
  projectIds: string[] | null
}

export type PnlRow = {
  kind: 'group' | 'overhead' | 'total'
  key: string
  label: string
  revenueHours: string
  fees: string
  discounts: string
  revenue: string
  labour: string
  gross: string
  directExpenses: string
  overhead: string
  net: string
  margin: string | null
  invoiced: string
  collected: string
}

const RANGE_MESSAGE = 'Choose an end date on or after the start date, within 3 years.'
const GROUP_MESSAGE = 'Choose how to group the report.'
const GROUPS: readonly string[] = ['month', 'quarter', 'client', 'project']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Search = Record<string, string | string[] | undefined>

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

function uuidList(v: string | string[] | undefined): string[] | null {
  const list = (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x) => UUID.test(x))
  return list.length > 0 ? list : null
}

/** `from` plus three calendar years, clamping Feb 29 to Feb 28. */
function plusThreeYears(from: string): string {
  const y = Number(from.slice(0, 4)) + 3
  const md = from.slice(5)
  const candidate = `${String(y).padStart(4, '0')}-${md}`
  return isIsoDate(candidate) ? candidate : `${String(y).padStart(4, '0')}-02-28`
}

export function parsePnlParams(search: Search, today: string): Result<PnlParams> {
  const from = first(search.from) || `${today.slice(0, 4)}-01-01`
  const to = first(search.to) || today
  if (!isIsoDate(from) || !isIsoDate(to) || to < from || to > plusThreeYears(from)) return fail(RANGE_MESSAGE)
  const group = first(search.group) || 'month'
  if (!GROUPS.includes(group)) return fail(GROUP_MESSAGE)
  return ok({
    from,
    to,
    group: group as PnlGroup,
    clientIds: uuidList(search.client),
    projectIds: uuidList(search.project),
  })
}

type PnlDb = {
  row_kind: PnlRow['kind']
  group_key: string
  label: string
  revenue_hours: string
  fees: string
  discounts: string
  revenue: string
  labour: string
  gross: string
  direct_expenses: string
  overhead: string
  net: string
  margin: string | null
  invoiced: string
  collected: string
}

export async function getPnl(db: SupabaseClient, firmId: string, params: PnlParams): Promise<Result<PnlRow[]>> {
  const { data, error } = await db.rpc('pnl_report', {
    p_firm: firmId,
    p_from: params.from,
    p_to: params.to,
    p_group: params.group,
    // An empty array matches nothing in SQL; null means "all".
    p_clients: params.clientIds && params.clientIds.length > 0 ? params.clientIds : null,
    p_projects: params.projectIds && params.projectIds.length > 0 ? params.projectIds : null,
  })
  if (error) return fail(mapDbError(error))
  return ok(
    ((data ?? []) as PnlDb[]).map((r) => ({
      kind: r.row_kind,
      key: r.group_key,
      label: r.label,
      revenueHours: r.revenue_hours,
      fees: r.fees,
      discounts: r.discounts,
      revenue: r.revenue,
      labour: r.labour,
      gross: r.gross,
      directExpenses: r.direct_expenses,
      overhead: r.overhead,
      net: r.net,
      margin: r.margin,
      invoiced: r.invoiced,
      collected: r.collected,
    })),
  )
}
