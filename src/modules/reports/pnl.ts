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
  /**
   * Breakdown columns, already normalised to what the group allows:
   * month/quarter: client, project (which implies client) or both;
   * client: project only; project: none (it always shows both columns).
   */
  split: { client: boolean; project: boolean }
}

export type PnlRow = {
  /**
   * 'group' rows come from pnl_report when there is no split. With a split,
   * each group becomes its 'detail' rows followed by a 'subtotal' row.
   */
  kind: 'group' | 'detail' | 'subtotal' | 'overhead' | 'total'
  key: string
  /** Group label; "{group} subtotal" on subtotal rows; detail rows repeat their group's label. */
  label: string
  /** Breakdown labels: filled on detail rows, and on project-grouping rows; null otherwise. */
  clientLabel: string | null
  projectLabel: string | null
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

function list(v: string | string[] | undefined): string[] {
  return Array.isArray(v) ? v : v === undefined ? [] : [v]
}

function uuidList(v: string | string[] | undefined): string[] | null {
  const ids = list(v).filter((x) => UUID.test(x))
  return ids.length > 0 ? ids : null
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
    split: normaliseSplit(group as PnlGroup, list(search.split)),
  })
}

/** Keeps only the breakdowns the group allows; a project split under a period implies the client column. */
function normaliseSplit(group: PnlGroup, values: string[]): PnlParams['split'] {
  const client = values.includes('client')
  const project = values.includes('project')
  if (group === 'month' || group === 'quarter') return { client: client || project, project }
  if (group === 'client') return { client: false, project }
  return { client: false, project: false }
}

/** Which breakdown columns the page and CSV show. Project grouping always shows both. */
export function pnlBreakdownColumns(params: Pick<PnlParams, 'group' | 'split'>): PnlParams['split'] {
  return params.group === 'project' ? { client: true, project: true } : params.split
}

type Measures = Pick<
  PnlRow,
  | 'revenueHours'
  | 'fees'
  | 'discounts'
  | 'revenue'
  | 'labour'
  | 'gross'
  | 'directExpenses'
  | 'overhead'
  | 'net'
  | 'margin'
  | 'invoiced'
  | 'collected'
>

type MeasuresDb = {
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

function measures(r: MeasuresDb): Measures {
  return {
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
  }
}

type PnlDb = MeasuresDb & {
  row_kind: 'group' | 'overhead' | 'total'
  group_key: string
  label: string
  client_label: string | null
  project_label: string | null
}

type BreakdownDb = MeasuresDb & {
  group_key: string
  client_label: string
  project_label: string | null
  sort_key: string
}

export async function getPnl(db: SupabaseClient, firmId: string, params: PnlParams): Promise<Result<PnlRow[]>> {
  const filters = {
    p_firm: firmId,
    p_from: params.from,
    p_to: params.to,
    p_group: params.group,
    // An empty array matches nothing in SQL; null means "all".
    p_clients: params.clientIds && params.clientIds.length > 0 ? params.clientIds : null,
    p_projects: params.projectIds && params.projectIds.length > 0 ? params.projectIds : null,
  }
  const { data, error } = await db.rpc('pnl_report', filters)
  if (error) return fail(mapDbError(error))
  const rows: PnlRow[] = ((data ?? []) as PnlDb[]).map((r) => ({
    kind: r.row_kind,
    key: r.group_key,
    label: r.label,
    clientLabel: r.client_label,
    projectLabel: r.project_label,
    ...measures(r),
  }))

  const split = params.group !== 'project' && (params.split.client || params.split.project)
  if (!split) return ok(rows)

  const detail = await db.rpc('pnl_breakdown', {
    ...filters,
    // Client grouping always breaks down by project; periods only when asked.
    p_split_project: params.split.project,
  })
  if (detail.error) return fail(mapDbError(detail.error))
  const byGroup = new Map<string, BreakdownDb[]>()
  for (const d of (detail.data ?? []) as BreakdownDb[]) {
    const bucket = byGroup.get(d.group_key) ?? []
    bucket.push(d)
    byGroup.set(d.group_key, bucket)
  }

  const out: PnlRow[] = []
  for (const r of rows) {
    if (r.kind !== 'group') {
      out.push(r)
      continue
    }
    const details = byGroup.get(r.key) ?? []
    // A group with no activity of its own (e.g. an idle month) stays a plain row,
    // not a lone "subtotal" with nothing above it.
    if (details.length === 0) {
      out.push(r)
      continue
    }
    for (const d of details) {
      out.push({
        kind: 'detail',
        key: `${r.key}:${d.sort_key}`,
        label: r.label,
        clientLabel: d.client_label,
        projectLabel: d.project_label,
        ...measures(d),
      })
    }
    out.push({ ...r, kind: 'subtotal', label: `${r.label} subtotal` })
  }
  return ok(out)
}
