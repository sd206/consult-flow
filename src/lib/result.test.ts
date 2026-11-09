import { describe, expect, it } from 'vitest'
import { fail, ok } from './result'

describe('result', () => {
  it('ok wraps data', () => {
    expect(ok(5)).toEqual({ ok: true, data: 5 })
  })
  it('fail wraps error', () => {
    expect(fail('x')).toEqual({ ok: false, error: 'x' })
  })
})
