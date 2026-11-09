import { describe, expect, it } from 'vitest'
import { formatMoney, parseMoney } from './money'

describe('parseMoney', () => {
  it('canonicalises valid input', () => {
    expect(parseMoney('1,250.5')).toEqual({ ok: true, data: '1250.50' })
    expect(parseMoney('0')).toEqual({ ok: true, data: '0.00' })
    expect(parseMoney('  12 ')).toEqual({ ok: true, data: '12.00' })
  })
  it.each(['-5', '1.234', 'abc', ''])('rejects %j', (input) => {
    expect(parseMoney(input).ok).toBe(false)
  })
})

describe('formatMoney', () => {
  it('formats with currency and locale', () => {
    expect(formatMoney('1250.5', 'USD', 'en-US')).toBe('$1,250.50')
  })
})
