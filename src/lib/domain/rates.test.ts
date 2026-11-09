import { describe, expect, it } from 'vitest'
import { rateOn } from './rates'

const rates = [
  { rate: '100', effectiveFrom: '2026-01-01' },
  { rate: '120', effectiveFrom: '2026-03-01' },
]

describe('rateOn', () => {
  it('picks the latest rate effective on the date', () => {
    expect(rateOn(rates, '2026-02-28')?.rate).toBe('100')
    expect(rateOn(rates, '2026-03-01')?.rate).toBe('120')
  })
  it('returns null before any rate starts', () => {
    expect(rateOn(rates, '2025-12-31')).toBeNull()
  })
  it('respects effectiveTo', () => {
    const closed = [{ rate: '100', effectiveFrom: '2026-01-01', effectiveTo: '2026-01-31' }]
    expect(rateOn(closed, '2026-02-01')).toBeNull()
    expect(rateOn(closed, '2026-01-31')?.rate).toBe('100')
  })
})
