import { describe, expect, it } from 'vitest'
import { safeNext } from './safe-next'

describe('safeNext', () => {
  it('allows same-origin relative paths', () => {
    expect(safeNext('/f/abc?x=1')).toBe('/f/abc?x=1')
  })
  it('rejects absolute, protocol-relative, backslash and empty values', () => {
    for (const v of ['https://evil.com', '//evil.com', '/' + String.fromCharCode(92) + 'evil.com', 'evil', '', null]) {
      expect(safeNext(v)).toBe('/')
    }
  })
})
