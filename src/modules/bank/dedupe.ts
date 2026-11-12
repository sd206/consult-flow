import { createHash } from 'node:crypto'
import { cleanDescription } from './clean'
import type { ParsedLine } from './types'

/**
 * One key per line, unique per account in the database.
 * With a bank id: `fitid:<id>`. Without: a hash of date, amount, cleaned
 * description and n, where n counts identical lines within this file, so two
 * identical purchases both import while a re-upload or overlapping file adds nothing.
 */
export function dedupeKeys(lines: ParsedLine[]): string[] {
  const seen = new Map<string, number>()
  return lines.map((l) => {
    if (l.bankRef) return `fitid:${l.bankRef}`
    const base = `${l.postedOn}|${l.amount}|${cleanDescription(l.description)}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return `h:${createHash('sha256').update(`${base}|${n}`).digest('hex')}`
  })
}
