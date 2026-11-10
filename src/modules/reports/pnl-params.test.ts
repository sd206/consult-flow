import { describe, expect, it } from 'vitest'
import { parsePnlParams } from './pnl'

const RANGE_MSG = 'Choose an end date on or after the start date, within 3 years.'
const GROUP_MSG = 'Choose how to group the report.'
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'

describe('parsePnlParams', () => {
  it('defaults to year-to-date by month', () => {
    expect(parsePnlParams({}, '2026-11-09')).toEqual({
      ok: true,
      data: {
        from: '2026-01-01',
        to: '2026-11-09',
        group: 'month',
        clientIds: null,
        projectIds: null,
        split: { client: false, project: false },
      },
    })
  })

  it('keeps only uuids from repeated client/project params', () => {
    const r = parsePnlParams({ client: [U1, 'junk', U2], project: 'nope' }, '2026-11-09')
    expect(r).toMatchObject({ ok: true, data: { clientIds: [U1, U2], projectIds: null } })
    const s = parsePnlParams({ project: U1 }, '2026-11-09')
    expect(s).toMatchObject({ ok: true, data: { projectIds: [U1] } })
  })

  it('rejects a reversed range', () => {
    expect(parsePnlParams({ from: '2026-05-01', to: '2026-04-01' }, '2026-11-09')).toEqual({ ok: false, error: RANGE_MSG })
  })

  it('rejects invalid dates', () => {
    expect(parsePnlParams({ from: '2026-02-30' }, '2026-11-09')).toEqual({ ok: false, error: RANGE_MSG })
    expect(parsePnlParams({ to: 'abc' }, '2026-11-09')).toEqual({ ok: false, error: RANGE_MSG })
  })

  it('accepts exactly 3 years but not a day more', () => {
    expect(parsePnlParams({ from: '2023-03-01', to: '2026-03-01' }, '2026-11-09').ok).toBe(true)
    expect(parsePnlParams({ from: '2023-03-01', to: '2026-03-02' }, '2026-11-09')).toEqual({ ok: false, error: RANGE_MSG })
  })

  it('handles a leap-day start', () => {
    expect(parsePnlParams({ from: '2024-02-29', to: '2027-02-28' }, '2026-11-09').ok).toBe(true)
    expect(parsePnlParams({ from: '2024-02-29', to: '2027-03-02' }, '2026-11-09').ok).toBe(false)
  })

  it('rejects an unknown group', () => {
    expect(parsePnlParams({ group: 'week' }, '2026-11-09')).toEqual({ ok: false, error: GROUP_MSG })
  })

  describe('split', () => {
    const split = (search: Record<string, string | string[]>) => {
      const r = parsePnlParams(search, '2026-11-09')
      if (!r.ok) throw new Error(r.error)
      return r.data.split
    }

    it('is off by default and ignores unknown values', () => {
      expect(split({})).toEqual({ client: false, project: false })
      expect(split({ split: ['nope', 'Client'] })).toEqual({ client: false, project: false })
    })

    it('allows client, project or both under month and quarter', () => {
      for (const group of ['month', 'quarter']) {
        expect(split({ group, split: 'client' })).toEqual({ client: true, project: false })
        expect(split({ group, split: ['client', 'project'] })).toEqual({ client: true, project: true })
      }
    })

    it('a project split implies the client column under month and quarter', () => {
      expect(split({ group: 'month', split: 'project' })).toEqual({ client: true, project: true })
      expect(split({ group: 'quarter', split: ['project'] })).toEqual({ client: true, project: true })
    })

    it('allows only project under client grouping', () => {
      expect(split({ group: 'client', split: 'client' })).toEqual({ client: false, project: false })
      expect(split({ group: 'client', split: ['client', 'project'] })).toEqual({ client: false, project: true })
    })

    it('ignores every split under project grouping', () => {
      expect(split({ group: 'project', split: ['client', 'project'] })).toEqual({ client: false, project: false })
    })
  })
})
