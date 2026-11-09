import { fail, ok, type Result } from '../result'

const HOURS_RE = /^\d{0,2}(\.\d{1,2})?$/
const HOURS_MESSAGE = 'Enter hours between 0.01 and 24, up to 2 decimal places.'

const HUNDRED = BigInt(100)

function toHundredths(value: string): bigint {
  const [whole, frac = ''] = value.split('.')
  return BigInt(whole || '0') * HUNDRED + BigInt(frac.padEnd(2, '0').slice(0, 2) || '0')
}

function format(hundredths: bigint): string {
  return `${(hundredths / HUNDRED).toString()}.${(hundredths % HUNDRED).toString().padStart(2, '0')}`
}

/** Parses a per-entry hours value: > 0 and <= 24, up to 2 dp. Returns a canonical 2-dp string. */
export function parseHours(input: string): Result<string> {
  const cleaned = input.trim()
  if (!/\d/.test(cleaned) || !HOURS_RE.test(cleaned)) return fail(HOURS_MESSAGE)
  const h = toHundredths(cleaned)
  if (h <= BigInt(0) || h > BigInt(2400)) return fail(HOURS_MESSAGE)
  return ok(format(h))
}

/** Exact sum of decimal-hour strings via integer hundredths; canonical 2-dp string. */
export function sumHours(values: string[]): string {
  return format(values.reduce((acc, v) => acc + toHundredths(v), BigInt(0)))
}
