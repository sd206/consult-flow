import { describe, expect, it } from 'vitest'
import { adminDb, newFirm, newUser, type TestUser } from './helpers'
import { FUTURE_WEEK, PAST_WEEK, seedTimesheetFixture } from './timesheet-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>
type Entry = { projectId: string; workDate: string; hours: string; note: string | null }
type EntryRow = { id: string; project_id: string; work_date: string; hours: string; note: string | null }

const text = (e: { message?: string; details?: string } | null) => `${e?.message} ${e?.details}`

const MON = '2026-10-05'
const TUE = '2026-10-06'
const WED = '2026-10-07'
const THU = '2026-10-08'

function save(
  user: TestUser,
  firmId: string,
  consultantId: string,
  entries: Entry[],
  weekStart = PAST_WEEK,
) {
  return user.db.rpc('save_timesheet_week', {
    p_firm: firmId,
    p_consultant: consultantId,
    p_week_start: weekStart,
    p_entries: entries,
  })
}

async function entriesOf(user: TestUser, timesheetId: string): Promise<EntryRow[]> {
  const { data, error } = await user.db.rpc('timesheet_entries', { p_timesheet: timesheetId })
  expect(error).toBeNull()
  return data as EntryRow[]
}

async function adminEntryCount(consultantId: string, weekStart = PAST_WEEK): Promise<number> {
  const db = adminDb()
  const { data: ts } = await db
    .from('timesheets')
    .select('id')
    .eq('consultant_id', consultantId)
    .eq('week_start', weekStart)
    .maybeSingle()
  if (!ts) return 0
  const { count } = await db
    .from('time_entries')
    .select('id', { count: 'exact', head: true })
    .eq('timesheet_id', (ts as { id: string }).id)
  return count ?? 0
}

async function addProjectAssignment(
  f: Firm,
  clientId: string,
  consultantId: string,
  from: string,
  to: string | null = null,
  projectId?: string,
) {
  const db = adminDb()
  let pid = projectId
  if (!pid) {
    const { data, error } = await db
      .from('projects')
      .insert({ firm_id: f.firmId, client_id: clientId, name: `P ${crypto.randomUUID()}` })
      .select('id')
      .single()
    expect(error).toBeNull()
    pid = (data as { id: string }).id
  }
  const { data, error } = await db
    .from('project_assignments')
    .insert({
      firm_id: f.firmId,
      project_id: pid,
      consultant_id: consultantId,
      client_rate: '200',
      effective_from: from,
      effective_to: to,
    })
    .select('id')
    .single()
  expect(error).toBeNull()
  return { projectId: pid, assignmentId: (data as { id: string }).id }
}

describe('timesheets db', () => {
  it('consultant saves own week', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const { data: id, error } = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: MON, hours: '8', note: 'Kickoff' },
      { projectId: fx.projectId, workDate: TUE, hours: '7.5', note: null },
    ])
    expect(error).toBeNull()
    expect(typeof id).toBe('string')

    const rows = await entriesOf(f.consultant, id as string)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => [r.work_date, r.hours, r.note])).toEqual([
      [MON, '8.00', 'Kickoff'],
      [TUE, '7.50', null],
    ])
    for (const r of rows) {
      expect(Object.keys(r).some((k) => k.includes('rate'))).toBe(false)
    }
  })

  it('save replaces the week', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const first = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: MON, hours: '8', note: null },
      { projectId: fx.projectId, workDate: TUE, hours: '7.5', note: null },
    ])
    expect(first.error).toBeNull()
    const second = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: WED, hours: '4', note: null },
    ])
    expect(second.error).toBeNull()
    expect(second.data).toBe(first.data)

    const rows = await entriesOf(f.consultant, second.data as string)
    expect(rows.map((r) => [r.work_date, r.hours])).toEqual([[WED, '4.00']])
  })

  it('empty save clears entries', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: MON, hours: '8', note: null },
    ])
    const { data: id, error } = await save(f.consultant, f.firmId, fx.consultantId, [])
    expect(error).toBeNull()
    expect(await entriesOf(f.consultant, id as string)).toHaveLength(0)

    const { data: ts } = await adminDb().from('timesheets').select('status').eq('id', id).single()
    expect((ts as { status: string }).status).toBe('draft')
  })

  it('future week rejected', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const { error } = await save(f.consultant, f.firmId, fx.consultantId, [], FUTURE_WEEK)
    expect(text(error)).toContain('FUTURE_WEEK')
  })

  it('non-Monday rejected', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const { error } = await save(f.consultant, f.firmId, fx.consultantId, [], '2026-10-06')
    expect(text(error)).toContain('timesheets_week_start_monday_chk')
  })

  it('outside the week rejected', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const { error } = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: MON, hours: '8', note: null },
      { projectId: fx.projectId, workDate: '2026-10-12', hours: '8', note: null },
    ])
    expect(text(error)).toContain('ENTRY_OUTSIDE_WEEK')
    expect(await adminEntryCount(fx.consultantId)).toBe(0)
  })

  it('assignment ending mid-week', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f, { assignTo: WED })
    const thu = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: THU, hours: '8', note: null },
    ])
    expect(text(thu.error)).toContain('NO_ASSIGNMENT')
    const wed = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: WED, hours: '8', note: null },
    ])
    expect(wed.error).toBeNull()
  })

  it('24h per day across projects', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const p2 = await addProjectAssignment(f, fx.clientId, fx.consultantId, '2026-01-01')
    const over = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: MON, hours: '16', note: null },
      { projectId: p2.projectId, workDate: MON, hours: '9', note: null },
    ])
    expect(text(over.error)).toContain('DAY_OVER_24')
    const ok = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: MON, hours: '16', note: null },
      { projectId: p2.projectId, workDate: MON, hours: '8', note: null },
    ])
    expect(ok.error).toBeNull()
  })

  it('hours bounds', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    for (const hours of ['0', '24.5']) {
      const { error } = await save(f.consultant, f.firmId, fx.consultantId, [
        { projectId: fx.projectId, workDate: MON, hours, note: null },
      ])
      expect(text(error)).toContain('time_entries_hours_chk')
    }
  })

  it('note length capped at 500 characters', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const long = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: MON, hours: '1', note: 'a'.repeat(501) },
    ])
    expect(text(long.error)).toContain('time_entries_note_len_chk')
    const max = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: MON, hours: '1', note: 'a'.repeat(500) },
    ])
    expect(max.error).toBeNull()
  })

  it('locked after submit', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const { data: id } = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: MON, hours: '8', note: null },
    ])
    const { error: upErr } = await adminDb()
      .from('timesheets')
      .update({ status: 'submitted' })
      .eq('id', id)
    expect(upErr).toBeNull()

    const { error } = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: TUE, hours: '4', note: null },
    ])
    expect(text(error)).toContain('TIMESHEET_LOCKED')
    const rows = await entriesOf(f.consultant, id as string)
    expect(rows.map((r) => [r.work_date, r.hours])).toEqual([[MON, '8.00']])
  })

  it('manager saves on behalf', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const { data: id, error } = await save(f.manager, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: MON, hours: '6', note: null },
    ])
    expect(error).toBeNull()
    expect(await entriesOf(f.consultant, id as string)).toHaveLength(1)
  })

  it('other consultant blocked', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const { data: id } = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: MON, hours: '8', note: null },
    ])
    const other = await newUser('consultant2')
    const { error: mErr } = await adminDb()
      .from('firm_members')
      .insert({ firm_id: f.firmId, user_id: other.id, role: 'consultant' })
    expect(mErr).toBeNull()

    const s = await save(other, f.firmId, fx.consultantId, [])
    expect(s.error?.code).toBe('42501')
    const wp = await other.db.rpc('week_projects', {
      p_firm: f.firmId,
      p_consultant: fx.consultantId,
      p_week_start: PAST_WEEK,
    })
    expect(wp.error?.code).toBe('42501')
    const te = await other.db.rpc('timesheet_entries', { p_timesheet: id })
    expect(te.error?.code).toBe('42501')
    expect(await adminEntryCount(fx.consultantId)).toBe(1)
  })

  it('other firm blocked', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const fx = await seedTimesheetFixture(a)
    const { data: id } = await save(a.consultant, a.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: MON, hours: '8', note: null },
    ])

    const s1 = await save(b.admin, a.firmId, fx.consultantId, [])
    expect(s1.error?.code).toBe('42501')
    const s2 = await save(b.admin, b.firmId, fx.consultantId, [])
    expect(text(s2.error)).toContain('CONSULTANT_NOT_FOUND')
    const te = await b.admin.db.rpc('timesheet_entries', { p_timesheet: id })
    expect(te.error?.code).toBe('42501')
    const wp = await b.admin.db.rpc('week_projects', {
      p_firm: a.firmId,
      p_consultant: fx.consultantId,
      p_week_start: PAST_WEEK,
    })
    expect(wp.error?.code).toBe('42501')

    const { data: ts } = await b.admin.db.from('timesheets').select('id').eq('id', id)
    expect(ts).toEqual([])
    const { data: te2 } = await b.admin.db.from('time_entries').select('id').eq('timesheet_id', id)
    expect(te2).toEqual([])
    expect(await adminEntryCount(fx.consultantId)).toBe(1)
  })

  it('other firm project rejected', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const fx = await seedTimesheetFixture(a)
    const fxB = await seedTimesheetFixture(b)
    const { error } = await save(a.consultant, a.firmId, fx.consultantId, [
      { projectId: fxB.projectId, workDate: MON, hours: '8', note: null },
    ])
    expect(error).not.toBeNull()
    expect(await adminEntryCount(fx.consultantId)).toBe(0)
  })

  it('no direct writes', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const { data: id } = await save(f.consultant, f.firmId, fx.consultantId, [])

    const ins = await f.consultant.db.from('time_entries').insert({
      firm_id: f.firmId,
      timesheet_id: id,
      project_id: fx.projectId,
      work_date: MON,
      hours: '8',
    })
    expect(ins.error).not.toBeNull()

    const up = await f.consultant.db
      .from('timesheets')
      .update({ status: 'approved' })
      .eq('id', id)
      .select()
    expect(up.error !== null || (up.data ?? []).length === 0).toBe(true)

    const mgr = await f.manager.db.from('timesheets').update({ status: 'approved' }).eq('id', id).select()
    expect(mgr.error !== null || (mgr.data ?? []).length === 0).toBe(true)

    const { data: ts } = await adminDb().from('timesheets').select('status').eq('id', id).single()
    expect((ts as { status: string }).status).toBe('draft')
    expect(await adminEntryCount(fx.consultantId)).toBe(0)
  })

  it('consultant cannot read entries table', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: MON, hours: '8', note: null },
    ])
    const { data: te, error: teErr } = await f.consultant.db.from('time_entries').select('*')
    expect(teErr).toBeNull()
    expect(te).toEqual([])
    const { data: ts, error: tsErr } = await f.consultant.db.from('timesheets').select('*')
    expect(tsErr).toBeNull()
    expect(ts).toHaveLength(1)

    const { data: mgrTe } = await f.manager.db.from('time_entries').select('id')
    expect(mgrTe).toHaveLength(1)
  })

  it('week_projects', async () => {
    const f = await newFirm()
    // Rate change mid-week: first row ends Tue, second starts Wed on the same project.
    const fx = await seedTimesheetFixture(f, { assignTo: TUE })
    const second = await addProjectAssignment(f, fx.clientId, fx.consultantId, WED, null, fx.projectId)
    // An assignment that ended before the week is not returned.
    await addProjectAssignment(f, fx.clientId, fx.consultantId, '2026-01-01', '2026-09-30')

    const { data, error } = await f.consultant.db.rpc('week_projects', {
      p_firm: f.firmId,
      p_consultant: fx.consultantId,
      p_week_start: PAST_WEEK,
    })
    expect(error).toBeNull()
    const rows = data as {
      assignment_id: string
      project_id: string
      effective_from: string
      effective_to: string | null
    }[]
    expect(rows.map((r) => [r.assignment_id, r.project_id, r.effective_from, r.effective_to])).toEqual([
      [fx.assignmentId, fx.projectId, '2026-01-01', TUE],
      [second.assignmentId, fx.projectId, WED, null],
    ])
    for (const r of rows) {
      expect(Object.keys(r).some((k) => k.includes('rate'))).toBe(false)
    }
  })
})

type SnapRow = {
  work_date: string
  client_rate_snapshot: string | null
  cost_rate_snapshot: string | null
}
type TsRow = {
  status: string
  submitted_at: string | null
  decided_by: string | null
  decided_at: string | null
  decision_comment: string | null
}

async function tsOf(id: string): Promise<TsRow> {
  const { data, error } = await adminDb()
    .from('timesheets')
    .select('status, submitted_at, decided_by, decided_at, decision_comment')
    .eq('id', id)
    .single()
  expect(error).toBeNull()
  return data as TsRow
}

async function snapsOf(id: string): Promise<SnapRow[]> {
  const { data, error } = await adminDb()
    .from('time_entries')
    .select('work_date, client_rate_snapshot::text, cost_rate_snapshot::text')
    .eq('timesheet_id', id)
    .order('work_date')
  expect(error).toBeNull()
  return data as SnapRow[]
}

const submit = (u: TestUser, id: string) => u.db.rpc('submit_timesheet', { p_timesheet: id })
const approve = (u: TestUser, id: string) => u.db.rpc('approve_timesheet', { p_timesheet: id })
const reject = (u: TestUser, id: string, comment: string | null) =>
  u.db.rpc('reject_timesheet', { p_timesheet: id, p_comment: comment })
const reopen = (u: TestUser, id: string) => u.db.rpc('reopen_timesheet', { p_timesheet: id })

async function savedWeek(
  f: Firm,
  fx: { consultantId: string; projectId: string },
  days = [MON, TUE],
): Promise<string> {
  const { data, error } = await save(
    f.consultant,
    f.firmId,
    fx.consultantId,
    days.map((d) => ({ projectId: fx.projectId, workDate: d, hours: '8', note: null })),
  )
  expect(error).toBeNull()
  return data as string
}

describe('timesheet workflow', () => {
  it('full cycle', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const id = await savedWeek(f, fx)

    expect((await submit(f.consultant, id)).error).toBeNull()
    const sub = await tsOf(id)
    expect(sub.status).toBe('submitted')
    expect(sub.submitted_at).not.toBeNull()

    const locked = await save(f.consultant, f.firmId, fx.consultantId, [])
    expect(text(locked.error)).toContain('TIMESHEET_LOCKED')

    expect((await approve(f.manager, id)).error).toBeNull()
    const ap = await tsOf(id)
    expect(ap.status).toBe('approved')
    expect(ap.decided_by).toBe(f.manager.id)
    expect(ap.decided_at).not.toBeNull()
    const snaps = await snapsOf(id)
    expect(snaps).toHaveLength(2)
    for (const s of snaps) {
      expect(s.client_rate_snapshot).toBe('150.00')
      expect(s.cost_rate_snapshot).toBe('90.00')
    }

    const { data: audit, error: aErr } = await adminDb()
      .from('audit_log')
      .select('action')
      .eq('entity_type', 'timesheets')
      .eq('entity_id', id)
      .eq('action', 'update')
    expect(aErr).toBeNull()
    expect((audit ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('rate change mid-week', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const rc = await f.manager.db.rpc('change_client_rate', {
      p_assignment: fx.assignmentId,
      p_rate: 175,
      p_from: '2026-10-07',
    })
    expect(rc.error).toBeNull()
    const id = await savedWeek(f, fx, [MON, WED])
    expect((await submit(f.consultant, id)).error).toBeNull()
    expect((await approve(f.manager, id)).error).toBeNull()
    expect((await snapsOf(id)).map((s) => [s.work_date, s.client_rate_snapshot])).toEqual([
      [MON, '150.00'],
      [WED, '175.00'],
    ])
  })

  it('cost rate missing', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f, { costFrom: '2026-10-06' })
    // Tue has a cost rate, Mon does not: nothing may be snapshotted.
    const id = await savedWeek(f, fx, [MON, TUE])
    expect((await submit(f.consultant, id)).error).toBeNull()
    const { error } = await approve(f.manager, id)
    expect(text(error)).toContain('COST_RATE_MISSING')
    const ts = await tsOf(id)
    expect(ts.status).toBe('submitted')
    expect(ts.decided_by).toBeNull()
    for (const s of await snapsOf(id)) {
      expect(s.client_rate_snapshot).toBeNull()
      expect(s.cost_rate_snapshot).toBeNull()
    }
  })

  it('empty submit', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const id = await savedWeek(f, fx, [])
    const { error } = await submit(f.consultant, id)
    expect(text(error)).toContain('TIMESHEET_EMPTY')
    expect((await tsOf(id)).status).toBe('draft')
  })

  it('consultant cannot approve or reject own', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const id = await savedWeek(f, fx)
    expect((await submit(f.consultant, id)).error).toBeNull()
    expect((await approve(f.consultant, id)).error?.code).toBe('42501')
    expect((await reject(f.consultant, id, 'no')).error?.code).toBe('42501')
    expect((await tsOf(id)).status).toBe('submitted')
  })

  it('manager approves own timesheet', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const db = adminDb()
    const { data: mc, error: mcErr } = await db
      .from('consultants')
      .insert({
        firm_id: f.firmId,
        name: 'Man Ager',
        email: `m-${crypto.randomUUID()}@test.local`,
        type: 'employee',
        user_id: f.manager.id,
      })
      .select('id')
      .single()
    expect(mcErr).toBeNull()
    const managerConsultantId = (mc as { id: string }).id
    const { error: crErr } = await db.from('consultant_cost_rates').insert({
      firm_id: f.firmId,
      consultant_id: managerConsultantId,
      hourly_cost: '120',
      effective_from: '2026-01-01',
    })
    expect(crErr).toBeNull()
    const { error: paErr } = await db.from('project_assignments').insert({
      firm_id: f.firmId,
      project_id: fx.projectId,
      consultant_id: managerConsultantId,
      client_rate: '250',
      effective_from: '2026-01-01',
    })
    expect(paErr).toBeNull()

    const { data, error } = await save(f.manager, f.firmId, managerConsultantId, [
      { projectId: fx.projectId, workDate: MON, hours: '5', note: null },
    ])
    expect(error).toBeNull()
    const id = data as string
    expect((await submit(f.manager, id)).error).toBeNull()
    expect((await approve(f.manager, id)).error).toBeNull()
    const ts = await tsOf(id)
    expect(ts.status).toBe('approved')
    expect(ts.decided_by).toBe(f.manager.id)
    expect((await snapsOf(id)).map((s) => [s.client_rate_snapshot, s.cost_rate_snapshot])).toEqual([
      ['250.00', '120.00'],
    ])
  })

  it('reject needs a comment', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const id = await savedWeek(f, fx)
    expect((await submit(f.consultant, id)).error).toBeNull()

    for (const c of ['  ', null]) {
      const { error } = await reject(f.manager, id, c)
      expect(text(error)).toContain('REJECT_COMMENT_REQUIRED')
    }
    expect((await tsOf(id)).status).toBe('submitted')

    expect((await reject(f.manager, id, '  Split by task ')).error).toBeNull()
    const rj = await tsOf(id)
    expect(rj.status).toBe('rejected')
    expect(rj.decision_comment).toBe('Split by task')
    expect(rj.decided_by).toBe(f.manager.id)
    expect(rj.decided_at).not.toBeNull()

    const edit = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: WED, hours: '6', note: 'Task A' },
    ])
    expect(edit.error).toBeNull()
    expect((await submit(f.consultant, id)).error).toBeNull()
    const re = await tsOf(id)
    expect(re.status).toBe('submitted')
    expect(re.decided_by).toBeNull()
    expect(re.decided_at).toBeNull()
    expect(re.decision_comment).toBeNull()
  })

  it('assignment removed after submit: approve fails with NO_ASSIGNMENT', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const id = await savedWeek(f, fx, [MON, TUE])
    expect((await submit(f.consultant, id)).error).toBeNull()
    // Assignment now ends before Tuesday, so Tuesday is uncovered.
    const { error: uErr } = await adminDb()
      .from('project_assignments')
      .update({ effective_to: MON })
      .eq('id', fx.assignmentId)
    expect(uErr).toBeNull()
    const { error } = await approve(f.manager, id)
    expect(text(error)).toContain('NO_ASSIGNMENT')
    const ts = await tsOf(id)
    expect(ts.status).toBe('submitted')
    expect(ts.decided_by).toBeNull()
    for (const s of await snapsOf(id)) {
      expect(s.client_rate_snapshot).toBeNull()
      expect(s.cost_rate_snapshot).toBeNull()
    }
  })

  it('timesheet_totals: managers only, scoped to the firm', async () => {
    const f = await newFirm()
    const g = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const id = await savedWeek(f, fx, [MON, TUE])
    const totals = (u: TestUser, firm: string) =>
      u.db.rpc('timesheet_totals', { p_firm: firm, p_ids: [id] })
    const mine = await totals(f.manager, f.firmId)
    expect(mine.error).toBeNull()
    expect(mine.data).toEqual([{ timesheet_id: id, total_hours: '16.00' }])
    expect((await totals(f.consultant, f.firmId)).error?.code).toBe('42501')
    expect((await totals(g.manager, f.firmId)).error?.code).toBe('42501')
    const other = await totals(g.manager, g.firmId)
    expect(other.error).toBeNull()
    expect(other.data).toEqual([])
  })

  it('approve from draft', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const id = await savedWeek(f, fx)
    expect(text((await approve(f.manager, id)).error)).toContain('TIMESHEET_STATE')
    expect(text((await reject(f.manager, id, 'x')).error)).toContain('TIMESHEET_STATE')
    expect(text((await reopen(f.manager, id)).error)).toContain('TIMESHEET_STATE')
    expect((await tsOf(id)).status).toBe('draft')
    expect((await submit(f.consultant, id)).error).toBeNull()
    expect(text((await submit(f.consultant, id)).error)).toContain('TIMESHEET_STATE')
    expect((await tsOf(id)).status).toBe('submitted')
  })

  it('timesheet not found', async () => {
    const f = await newFirm()
    for (const r of [
      await submit(f.manager, crypto.randomUUID()),
      await approve(f.manager, crypto.randomUUID()),
      await reject(f.manager, crypto.randomUUID(), 'x'),
      await reopen(f.manager, crypto.randomUUID()),
    ]) {
      expect(text(r.error)).toContain('TIMESHEET_NOT_FOUND')
    }
  })

  it('reopen', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const id = await savedWeek(f, fx)
    expect((await submit(f.consultant, id)).error).toBeNull()
    expect((await approve(f.manager, id)).error).toBeNull()
    expect((await reopen(f.consultant, id)).error?.code).toBe('42501')

    expect((await reopen(f.manager, id)).error).toBeNull()
    expect(await tsOf(id)).toEqual({
      status: 'draft',
      submitted_at: null,
      decided_by: null,
      decided_at: null,
      decision_comment: null,
    })
    const snaps = await snapsOf(id)
    expect(snaps).toHaveLength(2)
    for (const s of snaps) {
      expect(s.client_rate_snapshot).toBeNull()
      expect(s.cost_rate_snapshot).toBeNull()
    }
    const again = await save(f.consultant, f.firmId, fx.consultantId, [
      { projectId: fx.projectId, workDate: THU, hours: '3', note: null },
    ])
    expect(again.error).toBeNull()
  })

  it('reopen invoiced', async () => {
    const f = await newFirm()
    const fx = await seedTimesheetFixture(f)
    const id = await savedWeek(f, fx)
    expect((await submit(f.consultant, id)).error).toBeNull()
    expect((await approve(f.manager, id)).error).toBeNull()
    const { error: upErr } = await adminDb()
      .from('time_entries')
      .update({ invoice_line_id: crypto.randomUUID() })
      .eq('timesheet_id', id)
      .eq('work_date', MON)
    expect(upErr).toBeNull()

    expect(text((await reopen(f.manager, id)).error)).toContain('TIMESHEET_INVOICED')
    expect((await tsOf(id)).status).toBe('approved')
    for (const s of await snapsOf(id)) {
      expect(s.client_rate_snapshot).toBe('150.00')
      expect(s.cost_rate_snapshot).toBe('90.00')
    }
  })

  it('other firm cannot act', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const fx = await seedTimesheetFixture(a)
    const id = await savedWeek(a, fx)

    expect((await submit(b.admin, id)).error?.code).toBe('42501')
    expect((await tsOf(id)).status).toBe('draft')

    expect((await submit(a.consultant, id)).error).toBeNull()
    expect((await approve(b.admin, id)).error?.code).toBe('42501')
    expect((await reject(b.admin, id, 'nope')).error?.code).toBe('42501')
    const sub = await tsOf(id)
    expect(sub.status).toBe('submitted')
    expect(sub.decided_by).toBeNull()
    for (const s of await snapsOf(id)) {
      expect(s.client_rate_snapshot).toBeNull()
    }

    expect((await approve(a.manager, id)).error).toBeNull()
    expect((await reopen(b.admin, id)).error?.code).toBe('42501')
    const ts = await tsOf(id)
    expect(ts.status).toBe('approved')
    expect(ts.decided_by).toBe(a.manager.id)
    for (const s of await snapsOf(id)) {
      expect(s.client_rate_snapshot).toBe('150.00')
    }
  })
})
