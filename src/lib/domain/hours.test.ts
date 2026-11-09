import { describe, expect, it } from 'vitest'
import { parseHours, sumHours } from './hours'

describe('parseHours', () => {
  it.each([
    ['8', '8.00'],
    ['7.5', '7.50'],
    ['.25', '0.25'],
    [' 24 ', '24.00'],
  ])('accepts %s', (input, expected) => {
    expect(parseHours(input)).toEqual({ ok: true, data: expected })
  })
  it.each(['0', '24.01', '7,5', '1.234', '', '-1', 'abc'])('rejects %j', (input) => {
    const r = parseHours(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Enter hours between 0.01 and 24, up to 2 decimal places.')
  })
})

describe('sumHours', () => {
  it('sums exactly', () => {
    expect(sumHours(['7.50', '0.25', '8'])).toBe('15.75')
  })
  it('empty is 0.00', () => {
    expect(sumHours([])).toBe('0.00')
  })
})
