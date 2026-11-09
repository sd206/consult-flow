import { beforeAll, describe, expect, it } from 'vitest'
import { weekDays } from '@/lib/domain/weeks'
import {
  approveTimesheet,
  getMyConsultant,
  getTimesheetForReview,
  getTimesheetWeek,
  listAwaitingApproval,
  listWeekStatus,
  rejectTimesheet,
  saveTimesheetWeek,
  submitTimesheet,
} from '@/modules/timesheets/data'
import { adminDb, newFirm } from './helpers'
import { PAST_WEEK, seedTimesheetFixture } from './timesheet-fixtures'

const MON = '2026-10-05'
const TUE = '2026-10-06'

type Firm = Awaited<ReturnType<typeof newFirm>>
let f: Firm
let fx: Awaited<ReturnType<typeof seedTimesheetFixture>>

function unwrap<T>(r: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.data
}

beforeAll(async () => {
  f = await newFirm()
  fx = await seedTimesheetFixture(f)
})

describe('timesheets data module', () => {
  it('getMyConsultant: linked user gets the consultant, manager gets null', async () => {
    const mine = unwrap(await getMyConsultant(f.consultant.db, f.firmId))
    expect(mine?.id).toBe(fx.consultantId)
    expect(unwrap(await getMyConsultant(f.manager.db, f.firmId))).toBeNull()
  })

  it('rejects a non-Monday week', async () => {
    expect(await getTimesheetWeek(f.consultant.db, f.firmId, fx.consultantId, '2026-10-06')).toEqual({
      ok: false,
      error: 'Weeks start on Monday.',
    })
  })

  it('fresh week is not_started and editable', async () => {
    const w = unwrap(await getTimesheetWeek(f.consultant.db, f.firmId, fx.consultantId, PAST_WEEK))
    expect(w.status).toBe('not_started')
    expect(w.editable).toBe(true)
    expect(w.timesheetId).toBeNull()
    expect(w.projects).toHaveLength(1)
    expect(w.projects[0].activeDays).toHaveLength(7)
  })

  it('save, submit, queue, approve, review with rate snapshots', async () => {
    const { timesheetId } = unwrap(
      await saveTimesheetWeek(f.consultant.db, f.firmId, fx.consultantId, PAST_WEEK, [
        { projectId: fx.projectId, workDate: MON, hours: '8', note: 'Kickoff' },
        { projectId: fx.projectId, workDate: TUE, hours: '7.5', note: null },
      ]),
    )
    unwrap(await submitTimesheet(f.consultant.db, f.firmId, timesheetId))
    const w = unwrap(await getTimesheetWeek(f.consultant.db, f.firmId, fx.consultantId, PAST_WEEK))
    expect(w.status).toBe('submitted')
    expect(w.editable).toBe(false)
    expect(w.totalHours).toBe('15.50')

    const queue = unwrap(await listAwaitingApproval(f.manager.db, f.firmId))
    expect(queue.find((q) => q.timesheetId === timesheetId)?.totalHours).toBe('15.50')

    const bad = await rejectTimesheet(f.manager.db, f.firmId, timesheetId, '   ')
    expect(bad).toEqual({ ok: false, error: 'Add a comment saying what needs to change.' })

    unwrap(await approveTimesheet(f.manager.db, f.firmId, timesheetId))
    const review = unwrap(await getTimesheetForReview(f.manager.db, f.firmId, timesheetId))
    expect(review.entries).toHaveLength(2)
    for (const e of review.entries) {
      expect(e.clientRateSnapshot).toBe('150.00')
      expect(e.costRateSnapshot).toBe('90.00')
    }
  })

  it('listWeekStatus covers active consultants only', async () => {
    const g = await newFirm()
    const a = await seedTimesheetFixture(g)
    const db = adminDb()
    const mk = async (name: string, active: boolean) => {
      const { error } = await db.from('consultants').insert({
        firm_id: g.firmId,
        name,
        email: `${crypto.randomUUID()}@test.local`,
        type: 'employee',
        active,
      })
      expect(error).toBeNull()
    }
    await mk('Zed Never', true)
    await mk('Inactive', false)
    const { timesheetId } = unwrap(
      await saveTimesheetWeek(g.consultant.db, g.firmId, a.consultantId, PAST_WEEK, [
        { projectId: a.projectId, workDate: MON, hours: '4', note: null },
      ]),
    )
    unwrap(await submitTimesheet(g.consultant.db, g.firmId, timesheetId))
    unwrap(await approveTimesheet(g.manager.db, g.firmId, timesheetId))
    const rows = unwrap(await listWeekStatus(g.manager.db, g.firmId, PAST_WEEK))
    expect(rows.map((r) => r.status)).toEqual(['approved', 'not_started'])
    expect(rows[0].totalHours).toBe('4.00')
    expect(rows[1].totalHours).toBe('0.00')
  })

  it('queue totals match the timesheet_totals rpc', async () => {
    const g = await newFirm()
    const a = await seedTimesheetFixture(g)
    const { timesheetId } = unwrap(
      await saveTimesheetWeek(g.consultant.db, g.firmId, a.consultantId, PAST_WEEK, [
        { projectId: a.projectId, workDate: MON, hours: '7.25', note: null },
        { projectId: a.projectId, workDate: TUE, hours: '0.25', note: null },
      ]),
    )
    unwrap(await submitTimesheet(g.consultant.db, g.firmId, timesheetId))
    const { data, error } = await g.manager.db.rpc('timesheet_totals', {
      p_firm: g.firmId,
      p_ids: [timesheetId],
    })
    expect(error).toBeNull()
    expect(data).toEqual([{ timesheet_id: timesheetId, total_hours: '7.50' }])
    const queue = unwrap(await listAwaitingApproval(g.manager.db, g.firmId))
    expect(queue).toHaveLength(1)
    expect(queue[0].totalHours).toBe('7.50')
  })

  it('queue totals stay exact past 1,000 entries in a firm', async () => {
    const g = await newFirm()
    const a = await seedTimesheetFixture(g)
    const db = adminDb()
    // 25 projects x 7 days x 0.75h = 175 entries (131.25h, 18.75h a day) per week; 6 weeks = 1,050 entries.
    const { data: projects, error: pErr } = await db
      .from('projects')
      .insert(Array.from({ length: 25 }, (_, i) => ({ firm_id: g.firmId, client_id: a.clientId, name: `Bulk ${i}` })))
      .select('id')
    expect(pErr).toBeNull()
    const projectIds = (projects as { id: string }[]).map((p) => p.id)
    const { error: asErr } = await db.from('project_assignments').insert(
      projectIds.map((id) => ({
        firm_id: g.firmId,
        project_id: id,
        consultant_id: a.consultantId,
        client_rate: '100',
        effective_from: '2026-01-01',
      })),
    )
    expect(asErr).toBeNull()
    const weeks = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']
    const { data: sheets, error: tErr } = await db
      .from('timesheets')
      .insert(weeks.map((w) => ({ firm_id: g.firmId, consultant_id: a.consultantId, week_start: w })))
      .select('id, week_start')
    expect(tErr).toBeNull()
    const rows = (sheets as { id: string; week_start: string }[]).flatMap((t) =>
      projectIds.flatMap((pid) =>
        weekDays(t.week_start).map((d) => ({
          firm_id: g.firmId,
          timesheet_id: t.id,
          project_id: pid,
          work_date: d,
          hours: '0.75',
        })),
      ),
    )
    expect(rows).toHaveLength(1050)
    const { error: eErr } = await db.from('time_entries').insert(rows)
    expect(eErr).toBeNull()
    const { error: sErr } = await db
      .from('timesheets')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('firm_id', g.firmId)
    expect(sErr).toBeNull()

    const queue = unwrap(await listAwaitingApproval(g.manager.db, g.firmId))
    expect(queue).toHaveLength(6)
    expect(queue.map((q) => q.totalHours)).toEqual(Array(6).fill('131.25'))
  })

  it('consultant sees real names for hours on a project no longer assigned that week', async () => {
    const g = await newFirm()
    const a = await seedTimesheetFixture(g)
    unwrap(
      await saveTimesheetWeek(g.consultant.db, g.firmId, a.consultantId, PAST_WEEK, [
        { projectId: a.projectId, workDate: MON, hours: '3', note: null },
      ]),
    )
    const db = adminDb()
    const { error: uErr } = await db
      .from('project_assignments')
      .update({ effective_to: '2026-09-30' })
      .eq('id', a.assignmentId)
    expect(uErr).toBeNull()
    const { data: client } = await db.from('clients').select('name').eq('id', a.clientId).single()

    const w = unwrap(await getTimesheetWeek(g.consultant.db, g.firmId, a.consultantId, PAST_WEEK))
    expect(w.projects).toEqual([
      {
        projectId: a.projectId,
        projectName: 'Rollout',
        projectCode: null,
        clientName: (client as { name: string }).name,
        activeDays: [],
      },
    ])
  })
})
