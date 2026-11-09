import { fail, ok, type Result } from '../result'

const TOKEN_RE = /\{(YYYY|YY|MM|SEQ:(\d+))\}|[A-Za-z0-9\-_/.]|([\s\S])/g

export function validateInvoicePattern(pattern: string): Result<string> {
  if (pattern.length < 1 || pattern.length > 40) {
    return fail('Pattern must be 1 to 40 characters.')
  }
  let seqCount = 0
  for (const m of pattern.matchAll(TOKEN_RE)) {
    if (m[3] !== undefined) {
      return fail('Pattern may only contain letters, digits, - _ / . and the tokens {YYYY}, {YY}, {MM}, {SEQ:n}.')
    }
    if (m[2] !== undefined) {
      seqCount++
      const n = Number(m[2])
      if (n < 1 || n > 8) return fail('{SEQ:n} needs n between 1 and 8.')
    }
  }
  if (seqCount !== 1) return fail('Pattern must contain exactly one {SEQ:n}.')
  return ok(pattern)
}
