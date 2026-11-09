import { describe, expect, it } from 'vitest'
import { isIsoDate, todayIso } from './dates'

describe('todayIso', () => {
  it('formats the UTC date as YYYY-MM-DD', () => {
    expect(todayIso(new Date('2026-03-05T23:59:59Z'))).toBe('2026-03-05')
    expect(todayIso(new Date('2026-12-31T00:00:00Z'))).toBe('2026-12-31')
  })
})

describe('isIsoDate', () => {
  it('accepts real calendar dates only', () => {
    expect(isIsoDate('2026-02-28')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-2-3')).toBe(false)
    expect(isIsoDate('')).toBe(false)
  })
})
