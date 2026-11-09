import { describe, expect, it } from 'vitest'
import { weekDays } from '@/lib/domain/weeks'
import { groupWeekProjects, type WeekProjectRow } from './week-projects'

const DAYS = weekDays('2026-10-05')
const row = (over: Partial<WeekProjectRow>): WeekProjectRow => ({
  assignmentId: 'a1',
  projectId: 'p1',
  projectName: 'Rollout',
  projectCode: null,
  clientName: 'Acme',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  ...over,
})

describe('groupWeekProjects', () => {
  it('merges two rows for one project into all seven days', () => {
    const out = groupWeekProjects(
      [
        row({ assignmentId: 'a1', effectiveTo: '2026-10-06' }),
        row({ assignmentId: 'a2', effectiveFrom: '2026-10-07', effectiveTo: null }),
      ],
      DAYS,
    )
    expect(out).toHaveLength(1)
    expect(out[0].activeDays).toEqual(DAYS)
  })

  it('limits activeDays to a row ending Wednesday', () => {
    const out = groupWeekProjects([row({ effectiveTo: '2026-10-07' })], DAYS)
    expect(out[0].activeDays).toEqual(DAYS.slice(0, 3))
  })

  it('keeps projects in the order given', () => {
    const out = groupWeekProjects(
      [row({ projectId: 'p2', projectName: 'B' }), row({ projectId: 'p1', projectName: 'A' })],
      DAYS,
    )
    expect(out.map((p) => p.projectId)).toEqual(['p2', 'p1'])
  })
})
