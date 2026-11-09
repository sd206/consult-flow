import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import type { ProjectStatus } from '@/lib/db-types'
import { isIsoDate, todayIso } from '@/lib/domain/dates'
import { parseMoney } from '@/lib/domain/money'
import { rateOn } from '@/lib/domain/rates'
import { fail, ok, type Result } from '@/lib/result'

const DENIED = "You don't have permission to do that."
const DATES = 'The end date must be on or after the start date.'
const BAD_FROM = 'Enter a valid start date.'
const BAD_TO = 'Enter a valid end date.'

export type ProjectInput = {
  clientId: string
  name: string
  code?: string
  status: ProjectStatus
  startDate?: string
  endDate?: string
}

export type ProjectRow = {
  id: string
  clientId: string
  clientName: string
  name: string
  code: string | null
  status: ProjectStatus
  startDate: string | null
  endDate: string | null
}

export type AssignmentRow = {
  id: string
  consultantId: string
  consultantName: string
  clientRate: string
  effectiveFrom: string
  effectiveTo: string | null
  /** The consultant's cost rate in effect today (reference only), or null. */
  currentCost: string | null
}

export type ProjectDetail = ProjectRow & { assignments: AssignmentRow[] }

export type MyAssignment = {
  assignmentId: string
  projectId: string
  projectName: string
  projectCode: string | null
  clientName: string
  effectiveFrom: string
  effectiveTo: string | null
}

/** One row per project for the signed-in consultant; the period spans all their assignment periods. */
export type MyProject = {
  projectId: string
  projectName: string
  projectCode: string | null
  clientName: string
  /** Earliest effective_from across the consultant's assignments on this project. */
  from: string
  /** Latest effective_to, or null when any assignment is open-ended ("ongoing"). */
  to: string | null
}

type NameJoin = { name: string } | { name: string }[] | null
const joinName = (v: NameJoin): string => (Array.isArray(v) ? v[0]?.name : v?.name) ?? ''

const blankToNull = (v: string | undefined): string | null => {
  const t = v?.trim()
  return t ? t : null
}

type ProjectDbRow = {
  id: string
  client_id: string
  name: string
  code: string | null
  status: ProjectStatus
  start_date: string | null
  end_date: string | null
  clients: NameJoin
}

const PROJECT_SELECT = 'id, client_id, name, code, status, start_date, end_date, clients(name)'

function toProject(p: ProjectDbRow): ProjectRow {
  return {
    id: p.id,
    clientId: p.client_id,
    clientName: joinName(p.clients),
    name: p.name,
    code: p.code,
    status: p.status,
    startDate: p.start_date,
    endDate: p.end_date,
  }
}

function projectColumns(input: ProjectInput) {
  return {
    client_id: input.clientId,
    name: input.name.trim(),
    code: blankToNull(input.code),
    status: input.status,
    start_date: blankToNull(input.startDate),
    end_date: blankToNull(input.endDate),
  }
}

function checkProjectDates(input: ProjectInput): Result<void> {
  const start = blankToNull(input.startDate)
  const end = blankToNull(input.endDate)
  if (start && !isIsoDate(start)) return fail('Enter a valid start date.')
  if (end && !isIsoDate(end)) return fail('Enter a valid end date.')
  if (start && end && end < start) return fail(DATES)
  return ok(undefined)
}

export async function listProjects(
  db: SupabaseClient,
  firmId: string,
  opts: { clientId?: string; status?: ProjectStatus } = {},
): Promise<Result<ProjectRow[]>> {
  let q = db.from('projects').select(PROJECT_SELECT).eq('firm_id', firmId).order('name')
  if (opts.clientId) q = q.eq('client_id', opts.clientId)
  if (opts.status) q = q.eq('status', opts.status)
  const { data, error } = await q
  if (error) return fail(mapDbError(error))
  return ok(((data ?? []) as unknown as ProjectDbRow[]).map(toProject))
}

type AssignmentDbRow = {
  id: string
  consultant_id: string
  client_rate: string
  effective_from: string
  effective_to: string | null
  consultants: NameJoin
}

export async function getProject(db: SupabaseClient, firmId: string, id: string): Promise<Result<ProjectDetail>> {
  const { data, error } = await db
    .from('projects')
    .select(PROJECT_SELECT)
    .eq('firm_id', firmId)
    .eq('id', id)
    .maybeSingle()
  if (error) return fail(mapDbError(error))
  if (!data) return fail('Project not found.')

  const { data: rows, error: aErr } = await db
    .from('project_assignments')
    .select('id, consultant_id, client_rate:client_rate::text, effective_from, effective_to, consultants(name)')
    .eq('firm_id', firmId)
    .eq('project_id', id)
    .order('effective_from', { ascending: false })
  if (aErr) return fail(mapDbError(aErr))
  const assignments = (rows ?? []) as unknown as AssignmentDbRow[]

  const consultantIds = [...new Set(assignments.map((a) => a.consultant_id))]
  const costs = new Map<string, { rate: string; effectiveFrom: string }[]>()
  if (consultantIds.length > 0) {
    const { data: cRows, error: cErr } = await db
      .from('consultant_cost_rates')
      .select('consultant_id, hourly_cost:hourly_cost::text, effective_from')
      .eq('firm_id', firmId)
      .in('consultant_id', consultantIds)
    if (cErr) return fail(mapDbError(cErr))
    for (const r of (cRows ?? []) as { consultant_id: string; hourly_cost: string; effective_from: string }[]) {
      const list = costs.get(r.consultant_id) ?? []
      list.push({ rate: r.hourly_cost, effectiveFrom: r.effective_from })
      costs.set(r.consultant_id, list)
    }
  }

  const today = todayIso()
  return ok({
    ...toProject(data as unknown as ProjectDbRow),
    assignments: assignments.map((a) => ({
      id: a.id,
      consultantId: a.consultant_id,
      consultantName: joinName(a.consultants),
      clientRate: a.client_rate,
      effectiveFrom: a.effective_from,
      effectiveTo: a.effective_to,
      currentCost: rateOn(costs.get(a.consultant_id) ?? [], today)?.rate ?? null,
    })),
  })
}

export async function createProject(
  db: SupabaseClient,
  firmId: string,
  input: ProjectInput,
): Promise<Result<{ id: string }>> {
  const dates = checkProjectDates(input)
  if (!dates.ok) return dates
  const { data, error } = await db
    .from('projects')
    .insert({ firm_id: firmId, ...projectColumns(input) })
    .select('id')
    .single()
  if (error || !data) return fail(mapDbError(error))
  return ok({ id: data.id as string })
}

export async function updateProject(
  db: SupabaseClient,
  firmId: string,
  id: string,
  input: ProjectInput,
): Promise<Result<void>> {
  const dates = checkProjectDates(input)
  if (!dates.ok) return dates
  const { data, error } = await db
    .from('projects')
    .update(projectColumns(input))
    .eq('firm_id', firmId)
    .eq('id', id)
    .select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}

export async function addAssignment(
  db: SupabaseClient,
  firmId: string,
  input: { projectId: string; consultantId: string; clientRate: string; effectiveFrom: string; effectiveTo?: string | null },
): Promise<Result<{ id: string }>> {
  const rate = parseMoney(input.clientRate)
  if (!rate.ok) return rate
  const from = input.effectiveFrom.trim()
  if (!isIsoDate(from)) return fail(BAD_FROM)
  const to = input.effectiveTo?.trim() || null
  if (to !== null) {
    if (!isIsoDate(to)) return fail(BAD_TO)
    if (to < from) return fail(DATES)
  }
  const { data, error } = await db
    .from('project_assignments')
    .insert({
      firm_id: firmId,
      project_id: input.projectId,
      consultant_id: input.consultantId,
      client_rate: rate.data,
      effective_from: from,
      effective_to: to,
    })
    .select('id')
    .single()
  if (error || !data) return fail(mapDbError(error))
  return ok({ id: data.id as string })
}

export async function endAssignment(
  db: SupabaseClient,
  firmId: string,
  assignmentId: string,
  effectiveTo: string,
): Promise<Result<void>> {
  const to = effectiveTo.trim()
  if (!isIsoDate(to)) return fail(BAD_TO)
  const { data: row, error: readErr } = await db
    .from('project_assignments')
    .select('effective_from')
    .eq('firm_id', firmId)
    .eq('id', assignmentId)
    .maybeSingle()
  if (readErr) return fail(mapDbError(readErr))
  if (!row) return fail(DENIED)
  if (to < (row.effective_from as string)) return fail(DATES)

  const { data, error } = await db
    .from('project_assignments')
    .update({ effective_to: to })
    .eq('firm_id', firmId)
    .eq('id', assignmentId)
    .select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}

export async function changeClientRate(
  db: SupabaseClient,
  firmId: string,
  assignmentId: string,
  input: { clientRate: string; effectiveFrom: string },
): Promise<Result<{ id: string }>> {
  const rate = parseMoney(input.clientRate)
  if (!rate.ok) return rate
  const from = input.effectiveFrom.trim()
  if (!isIsoDate(from)) return fail(BAD_FROM)

  // The RPC has no firm argument: confirm the assignment belongs to this firm (and is visible) first.
  const { data: row, error: readErr } = await db
    .from('project_assignments')
    .select('id')
    .eq('firm_id', firmId)
    .eq('id', assignmentId)
    .maybeSingle()
  if (readErr) return fail(mapDbError(readErr))
  if (!row) return fail(DENIED)

  const { data, error } = await db.rpc('change_client_rate', {
    p_assignment: assignmentId,
    p_rate: rate.data,
    p_from: from,
  })
  if (error || typeof data !== 'string') return fail(mapDbError(error))
  return ok({ id: data })
}

export async function listMyAssignments(db: SupabaseClient, firmId: string): Promise<Result<MyAssignment[]>> {
  const { data, error } = await db.rpc('my_assignments', { p_firm: firmId })
  if (error) return fail(mapDbError(error))
  return ok(
    ((data ?? []) as {
      assignment_id: string
      project_id: string
      project_name: string
      project_code: string | null
      client_name: string
      effective_from: string
      effective_to: string | null
    }[]).map((a) => ({
      assignmentId: a.assignment_id,
      projectId: a.project_id,
      projectName: a.project_name,
      projectCode: a.project_code,
      clientName: a.client_name,
      effectiveFrom: a.effective_from,
      effectiveTo: a.effective_to,
    })),
  )
}

/** Groups assignment periods by project (a rate change must not list the project twice). */
export function groupMyProjects(assignments: MyAssignment[]): MyProject[] {
  const byProject = new Map<string, MyProject>()
  for (const a of assignments) {
    const seen = byProject.get(a.projectId)
    if (!seen) {
      byProject.set(a.projectId, {
        projectId: a.projectId,
        projectName: a.projectName,
        projectCode: a.projectCode,
        clientName: a.clientName,
        from: a.effectiveFrom,
        to: a.effectiveTo,
      })
      continue
    }
    if (a.effectiveFrom < seen.from) seen.from = a.effectiveFrom
    seen.to = seen.to === null || a.effectiveTo === null ? null : a.effectiveTo > seen.to ? a.effectiveTo : seen.to
  }
  return [...byProject.values()].sort((x, y) => x.projectName.localeCompare(y.projectName))
}

export async function listMyProjects(db: SupabaseClient, firmId: string): Promise<Result<MyProject[]>> {
  const assignments = await listMyAssignments(db, firmId)
  if (!assignments.ok) return assignments
  return ok(groupMyProjects(assignments.data))
}
