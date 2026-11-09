import { describe, expect, it } from 'vitest'
import { addDays, currentWeekStart, formatDayLabel, isFutureWeek, weekDays, weekStartOf } from './weeks'

describe('weeks', () => {
  it('weekStartOf returns the Monday on or before', () => {
    expect(weekStartOf('2026-11-15')).toBe('2026-11-09')
    expect(weekStartOf('2026-11-09')).toBe('2026-11-09')
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28')
  })
  it('weekDays and addDays', () => {
    const days = weekDays('2026-11-09')
    expect(days).toHaveLength(7)
    expect(days[0]).toBe('2026-11-09')
    expect(days[6]).toBe('2026-11-15')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('currentWeekStart uses UTC today', () => {
    expect(currentWeekStart(new Date('2026-11-11T23:30:00Z'))).toBe('2026-11-09')
  })
  it('isFutureWeek', () => {
    const now = new Date('2026-11-15T12:00:00Z')
    expect(isFutureWeek('2026-11-16', now)).toBe(true)
    expect(isFutureWeek('2026-11-09', now)).toBe(false)
  })
  it('formatDayLabel', () => {
    expect(formatDayLabel('2026-11-09')).toBe('Mon 9 Nov')
  })
})
