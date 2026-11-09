import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import type { TimesheetStatus } from '@/lib/db-types'
import { isIsoDate } from '@/lib/domain/dates'
import { sumHours } from '@/lib/domain/hours'
import { weekDays, weekStartOf } from '@/lib/domain/weeks'
import { fail, ok, type Result } from '@/lib/result'
import { groupWeekProjects, type WeekProjectRow } from './week-projects'

export type WeekStatus = TimesheetStatus | 'not_started'

export type WeekProject = {
  projectId: string
  projectName: string
  projectCode: string | null
  clientName: string
  activeDays: string[]
}

export type WeekEntry = { id: string; projectId: string; workDate: string; hours: string; note: string | null }
export type EntryInput = { projectId: string; workDate: string; hours: string; note: string | null }

export type TimesheetWeek = {
  consultantId: string
  consultantName: string
  weekStart: string
  timesheetId: string | null
  status: WeekStatus
  decisionComment: string | null
  projects: WeekProject[]
  entries: WeekEntry[]
  totalHours: string
  editable: boolean
}

export type QueueRow = {
  timesheetId: string
  consultantName: string
  weekStart: string
  totalHours: string
  submittedAt: string
}

export type WeekStatusRow = {
  consultantId: string
  consultantName: string
  timesheetId: string | null
  status: WeekStatus
  totalHours: string
}

export type ReviewEntry = WeekEntry & { clientRateSnapshot: string | null; costRateSnapshot: string | null }

export type ReviewTimesheet = Omit<TimesheetWeek, 'timesheetId' | 'entries' | 'editable'> & {
  timesheetId: string
  entries: ReviewEntry[]
  submittedAt: string | null
}

type NameJoin = { name: string } | { name: string }[] | null
const joinName = (v: NameJoin): string => (Array.isArray(v) ? v[0]?.name : v?.name) ?? ''

const EDITABLE: WeekStatus[] = ['not_started', 'draft', 'rejected']

type EntryDbRow = { id: string; project_id: string; work_date: string; hours: string; note: string | null }
const toEntry = (e: EntryDbRow): WeekEntry => ({
  id: e.id,
  projectId: e.project_id,
  workDate: e.work_date,
  hours: e.hours,
  note: e.note,
})

export async function getMyConsultant(
  db: SupabaseClient,
  firmId: string,
): Promise<Result<{ id: string; name: string } | null>> {
  const { data: auth, error: aErr } = await db.auth.getUser()
  if (aErr || !auth.user) return fail("You don't have permission to do that.")
  const { data, error } = await db
    .from('consultants')
    .select('id, name')
    .eq('firm_id', firmId)
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (error) return fail(mapDbError(error))
  return ok(data ? { id: data.id as string, name: data.name as string } : null)
}

type TimesheetProjectRow = { project_id: string; project_name: string; project_code: string | null; client_name: string }

export async function getTimesheetWeek(
  db: SupabaseClient,
  firmId: string,
  consultantId: string,
  weekStart: string,
): Promise<Result<TimesheetWeek>> {
  if (!isIsoDate(weekStart) || weekStartOf(weekStart) !== weekStart) return fail('Weeks start on Monday.')

  const { data: consultant, error: cErr } = await db
    .from('consultants')
    .select('name')
    .eq('firm_id', firmId)
    .eq('id', consultantId)
    .maybeSingle()
  if (cErr) return fail(mapDbError(cErr))
  if (!consultant) return fail('Consultant not found.')

  const { data: ts, error: tErr } = await db
    .from('timesheets')
    .select('id, status, decision_comment')
    .eq('firm_id', firmId)
    .eq('consultant_id', consultantId)
    .eq('week_start', weekStart)
    .maybeSingle()
  if (tErr) return fail(mapDbError(tErr))

  const { data: projRows, error: pErr } = await db.rpc('week_projects', {
    p_firm: firmId,
    p_consultant: consultantId,
    p_week_start: weekStart,
  })
  if (pErr) return fail(mapDbError(pErr))

  let entries: WeekEntry[] = []
  if (ts) {
    const { data: eRows, error: eErr } = await db.rpc('timesheet_entries', { p_timesheet: ts.id as string })
    if (eErr) return fail(mapDbError(eErr))
    entries = ((eRows ?? []) as EntryDbRow[]).map(toEntry)
  }

  const rows: WeekProjectRow[] = (
    (projRows ?? []) as {
      assignment_id: string
      project_id: string
      project_name: string
      project_code: string | null
      client_name: string
      effective_from: string
      effective_to: string | null
    }[]
  ).map((r) => ({
    assignmentId: r.assignment_id,
    projectId: r.project_id,
    projectName: r.project_name,
    projectCode: r.project_code,
    clientName: r.client_name,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  }))
  const projects = groupWeekProjects(rows, weekDays(weekStart))

  // Projects with hours but no assignment cover this week still show, read-only in effect (no active days).
  const known = new Set(projects.map((p) => p.projectId))
  // Names come from timesheet_projects: consultants can't read `projects` directly.
  const missing = [...new Set(entries.map((e) => e.projectId))].filter((id) => !known.has(id))
  if (ts && missing.length > 0) {
    const { data: pRows, error: lErr } = await db.rpc('timesheet_projects', { p_timesheet: ts.id as string })
    if (lErr) return fail(mapDbError(lErr))
    const found = new Map(((pRows ?? []) as TimesheetProjectRow[]).map((p) => [p.project_id, p]))
    for (const id of missing) {
      const p = found.get(id)
      projects.push({
        projectId: id,
        projectName: p?.project_name ?? 'Unknown project',
        projectCode: p?.project_code ?? null,
        clientName: p?.client_name ?? '',
        activeDays: [],
      })
    }
  }

  const status: WeekStatus = ts ? (ts.status as TimesheetStatus) : 'not_started'
  return ok({
    consultantId,
    consultantName: consultant.name as string,
    weekStart,
    timesheetId: ts ? (ts.id as string) : null,
    status,
    decisionComment: ts ? (ts.decision_comment as string | null) : null,
    projects,
    entries,
    totalHours: sumHours(entries.map((e) => e.hours)),
    editable: EDITABLE.includes(status),
  })
}

export async function saveTimesheetWeek(
  db: SupabaseClient,
  firmId: string,
  consultantId: string,
  weekStart: string,
  entries: EntryInput[],
): Promise<Result<{ timesheetId: string }>> {
  const { data, error } = await db.rpc('save_timesheet_week', {
    p_firm: firmId,
    p_consultant: consultantId,
    p_week_start: weekStart,
    p_entries: entries,
  })
  if (error) return fail(mapDbError(error))
  return ok({ timesheetId: data as string })
}

async function transition(
  db: SupabaseClient,
  fn: 'submit_timesheet' | 'approve_timesheet' | 'reopen_timesheet',
  timesheetId: string,
): Promise<Result<void>> {
  const { error } = await db.rpc(fn, { p_timesheet: timesheetId })
  if (error) return fail(mapDbError(error))
  return ok(undefined)
}

export const submitTimesheet = (db: SupabaseClient, _firmId: string, timesheetId: string) =>
  transition(db, 'submit_timesheet', timesheetId)
export const approveTimesheet = (db: SupabaseClient, _firmId: string, timesheetId: string) =>
  transition(db, 'approve_timesheet', timesheetId)
export const reopenTimesheet = (db: SupabaseClient, _firmId: string, timesheetId: string) =>
  transition(db, 'reopen_timesheet', timesheetId)

export async function rejectTimesheet(
  db: SupabaseClient,
  _firmId: string,
  timesheetId: string,
  comment: string,
): Promise<Result<void>> {
  const { error } = await db.rpc('reject_timesheet', { p_timesheet: timesheetId, p_comment: comment })
  if (error) return fail(mapDbError(error))
  return ok(undefined)
}

/** Total hours per timesheet id, summed in SQL by timesheet_totals (managers only). */
async function totalsFor(
  db: SupabaseClient,
  firmId: string,
  timesheetIds: string[],
): Promise<Result<Map<string, string>>> {
  const totals = new Map<string, string>()
  if (timesheetIds.length === 0) return ok(totals)
  const { data, error } = await db.rpc('timesheet_totals', { p_firm: firmId, p_ids: timesheetIds })
  if (error) return fail(mapDbError(error))
  for (const r of (data ?? []) as { timesheet_id: string; total_hours: string }[]) {
    totals.set(r.timesheet_id, r.total_hours)
  }
  return ok(totals)
}

export async function listAwaitingApproval(db: SupabaseClient, firmId: string): Promise<Result<QueueRow[]>> {
  const { data, error } = await db
    .from('timesheets')
    .select('id, week_start, submitted_at, consultants(name)')
    .eq('firm_id', firmId)
    .eq('status', 'submitted')
    .order('week_start', { ascending: true })
    .order('submitted_at', { ascending: true })
  if (error) return fail(mapDbError(error))
  const rows = (data ?? []) as unknown as {
    id: string
    week_start: string
    submitted_at: string | null
    consultants: NameJoin
  }[]
  const totals = await totalsFor(
    db,
    firmId,
    rows.map((r) => r.id),
  )
  if (!totals.ok) return totals
  return ok(
    rows.map((r) => ({
      timesheetId: r.id,
      consultantName: joinName(r.consultants),
      weekStart: r.week_start,
      totalHours: totals.data.get(r.id) ?? '0.00',
      submittedAt: r.submitted_at ?? '',
    })),
  )
}

export async function listWeekStatus(
  db: SupabaseClient,
  firmId: string,
  weekStart: string,
): Promise<Result<WeekStatusRow[]>> {
  const { data: cons, error: cErr } = await db
    .from('consultants')
    .select('id, name')
    .eq('firm_id', firmId)
    .eq('active', true)
    .order('name')
  if (cErr) return fail(mapDbError(cErr))
  const { data: tss, error: tErr } = await db
    .from('timesheets')
    .select('id, consultant_id, status')
    .eq('firm_id', firmId)
    .eq('week_start', weekStart)
  if (tErr) return fail(mapDbError(tErr))
  const sheets = (tss ?? []) as { id: string; consultant_id: string; status: TimesheetStatus }[]
  const totals = await totalsFor(
    db,
    firmId,
    sheets.map((t) => t.id),
  )
  if (!totals.ok) return totals
  const byConsultant = new Map(sheets.map((t) => [t.consultant_id, t]))
  return ok(
    ((cons ?? []) as { id: string; name: string }[]).map((c) => {
      const t = byConsultant.get(c.id)
      return {
        consultantId: c.id,
        consultantName: c.name,
        timesheetId: t?.id ?? null,
        status: t ? t.status : 'not_started',
        totalHours: t ? (totals.data.get(t.id) ?? '0.00') : '0.00',
      }
    }),
  )
}

export async function getTimesheetForReview(
  db: SupabaseClient,
  firmId: string,
  timesheetId: string,
): Promise<Result<ReviewTimesheet>> {
  const { data: ts, error } = await db
    .from('timesheets')
    .select('id, consultant_id, week_start, status, submitted_at, decision_comment, consultants(name)')
    .eq('firm_id', firmId)
    .eq('id', timesheetId)
    .maybeSingle()
  if (error) return fail(mapDbError(error))
  if (!ts) return fail('Timesheet not found.')
  const t = ts as unknown as {
    id: string
    consultant_id: string
    week_start: string
    status: TimesheetStatus
    submitted_at: string | null
    decision_comment: string | null
    consultants: NameJoin
  }

  const { data: eRows, error: eErr } = await db
    .from('time_entries')
    .select(
      'id, project_id, work_date, hours:hours::text, note, client_rate_snapshot:client_rate_snapshot::text, cost_rate_snapshot:cost_rate_snapshot::text',
    )
    .eq('firm_id', firmId)
    .eq('timesheet_id', timesheetId)
    .order('work_date')
  if (eErr) return fail(mapDbError(eErr))
  const entries: ReviewEntry[] = (
    (eRows ?? []) as unknown as (EntryDbRow & {
      client_rate_snapshot: string | null
      cost_rate_snapshot: string | null
    })[]
  ).map((e) => ({
    ...toEntry(e),
    clientRateSnapshot: e.client_rate_snapshot,
    costRateSnapshot: e.cost_rate_snapshot,
  }))

  const week = await getTimesheetWeek(db, firmId, t.consultant_id, t.week_start)
  if (!week.ok) return week
  return ok({
    consultantId: t.consultant_id,
    consultantName: joinName(t.consultants) || week.data.consultantName,
    weekStart: t.week_start,
    timesheetId: t.id,
    status: t.status,
    decisionComment: t.decision_comment,
    projects: week.data.projects,
    entries,
    totalHours: sumHours(entries.map((e) => e.hours)),
    submittedAt: t.submitted_at,
  })
}
