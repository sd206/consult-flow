import { describe, expect, it } from 'vitest'
import { validateInvoicePattern } from './invoice-pattern'

describe('validateInvoicePattern', () => {
  it.each(['INV-{YYYY}-{SEQ:4}', 'SRS/{YY}{MM}/{SEQ:3}'])('accepts %s', (p) => {
    expect(validateInvoicePattern(p)).toEqual({ ok: true, data: p })
  })
  it.each(['INV-{YYYY}', '{SEQ:4}-{SEQ:2}', '{SEQ:9}', '{SEQ:0}', 'INV {SEQ:4}', 'INV\n{SEQ:4}', 'INV\r{SEQ:4}','{FOO}-{SEQ:4}', '', `${'A'.repeat(40)}{SEQ:4}`])(
    'rejects %j',
    (p) => {
      expect(validateInvoicePattern(p).ok).toBe(false)
    },
  )
})
