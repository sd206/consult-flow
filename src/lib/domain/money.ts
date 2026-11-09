import { fail, ok, type Result } from '../result'

const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/

export function parseMoney(input: string): Result<string> {
  const cleaned = input.trim().replace(/,/g, '')
  if (!MONEY_RE.test(cleaned)) return fail('Enter a valid amount (up to 2 decimal places).')
  const [whole, frac = ''] = cleaned.split('.')
  return ok(`${whole}.${frac.padEnd(2, '0')}`)
}

export function formatMoney(amount: string, currency: string, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount))
}

const HUNDRED = BigInt(100)
const ZERO = BigInt(0)

function toCents(amount: string): bigint {
  const neg = amount.startsWith('-')
  const [whole, frac = ''] = (neg ? amount.slice(1) : amount).split('.')
  const cents = BigInt(whole || '0') * HUNDRED + BigInt(frac.padEnd(2, '0').slice(0, 2) || '0')
  return neg ? -cents : cents
}

/** Exact a - b on decimal strings via BigInt cents; canonical 2-dp result, negative allowed. */
export function subtractMoney(a: string, b: string): string {
  const diff = toCents(a) - toCents(b)
  const neg = diff < ZERO
  const abs = neg ? -diff : diff
  const frac = (abs % HUNDRED).toString().padStart(2, '0')
  return `${neg ? '-' : ''}${(abs / HUNDRED).toString()}.${frac}`
}
