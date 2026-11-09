import { beforeAll, describe, expect, it } from 'vitest'
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
    expect(rows[1].totalHours).toBe('0.00')
  })
})
