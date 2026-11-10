import { describe, expect, it } from 'vitest'
import { MAX_REJECTED_NAMES, rejectedFilesNotice, rejectedFilesParam } from './rejected-files'

describe('rejected files notice', () => {
  it('joins names and puts them in the fixed sentence', () => {
    const p = rejectedFilesParam(['a.exe', 'b.txt'])
    expect(p).toBe('a.exe, b.txt')
    expect(rejectedFilesNotice(p)).toBe("Expense saved, but some receipts weren't attached: a.exe, b.txt.")
  })

  it('caps the names at 300 characters', () => {
    const long = 'x'.repeat(1000)
    expect(rejectedFilesParam([long])).toHaveLength(MAX_REJECTED_NAMES)
    const notice = rejectedFilesNotice(long)!
    expect(notice).toBe(`Expense saved, but some receipts weren't attached: ${'x'.repeat(300)}.`)
  })

  it('ignores a missing, repeated or blank value and strips control characters', () => {
    expect(rejectedFilesNotice(undefined)).toBeNull()
    expect(rejectedFilesNotice(['a', 'b'])).toBeNull()
    expect(rejectedFilesNotice('  ')).toBeNull()
    expect(rejectedFilesNotice('a\u0000b\nc.pdf')).toBe("Expense saved, but some receipts weren't attached: abc.pdf.")
  })
})
