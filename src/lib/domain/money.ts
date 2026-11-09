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
