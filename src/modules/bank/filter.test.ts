import { describe, expect, it } from 'vitest'
import { filterLines, payeeFromDescription } from './filter'

const l = (id: string, amount: string, description: string) => ({ id, amount, description })
const LINES = [l('a', '-12.00', 'UBER *TRIP 1'), l('b', '-30.00', 'Delta Air'), l('c', '500.00', 'ACH CREDIT UBER CORP'), l('d', '-4.00', 'uber eats')]

describe('filterLines', () => {
  it('matches text anywhere, ignoring case and extra spaces', () => {
    expect(filterLines(LINES, '  Uber ', 'all').map((x) => x.id)).toEqual(['a', 'c', 'd'])
    expect(filterLines(LINES, '', 'all')).toHaveLength(4)
  })

  it('filters by direction', () => {
    expect(filterLines(LINES, 'uber', 'out').map((x) => x.id)).toEqual(['a', 'd'])
    expect(filterLines(LINES, '', 'in').map((x) => x.id)).toEqual(['c'])
  })
})

describe('payeeFromDescription', () => {
  it('uses the cleaned description, falling back to the raw text', () => {
    expect(payeeFromDescription('AMZN Mktp US*2K4LL9 ')).toBe('AMZN MKTP US')
    expect(payeeFromDescription('GLOBEX CORP PAYMENT – ACH CREDIT')).toBe('GLOBEX CORP PAYMENT')
    expect(payeeFromDescription('*12345')).toBe('*12345')
    expect(payeeFromDescription('x'.repeat(300))).toHaveLength(80)
  })
})
