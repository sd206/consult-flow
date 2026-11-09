import { describe, expect, it } from 'vitest'
import { formatMoney, formatMoneyCode, parseMoney, subtractMoney } from './money'

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

describe('subtractMoney', () => {
  it('subtracts exactly', () => {
    expect(subtractMoney('150.00', '90.00')).toBe('60.00')
    expect(subtractMoney('90', '150.5')).toBe('-60.50')
    expect(subtractMoney('0.10', '0.20')).toBe('-0.10')
    expect(subtractMoney('5.00', '5.00')).toBe('0.00')
  })
})

describe('formatMoneyCode', () => {
  it('formats with the currency code and a regular space', () => {
    expect(formatMoneyCode('1234.5', 'USD')).toBe('USD 1,234.50')
    expect(formatMoneyCode('0', 'EUR')).toBe('EUR 0.00')
  })
})
