import { describe, expect, it } from 'vitest'
import { formatInvoiceNumber } from './invoice-number'

describe('formatInvoiceNumber', () => {
  it.each([
    ['SRS-{YYYY}-{SEQ:4}', 42, '2026-11-09', 'SRS-2026-0042'],
    ['INV{YY}{MM}-{SEQ:3}', 7, '2027-01-31', 'INV2701-007'],
    ['{SEQ:2}', 1234, '2026-11-09', '1234'],
    ['A/{YYYY}/{SEQ:1}', 5, '2026-03-01', 'A/2026/5'],
  ])('%s #%i on %s -> %s', (pattern, seq, date, expected) => {
    expect(formatInvoiceNumber(pattern, seq, date)).toBe(expected)
  })
})
