export type ParsedLine = {
  /** YYYY-MM-DD */
  postedOn: string
  /** Signed, two decimals: + money in, − money out. Never zero. */
  amount: string
  description: string
  bankRef: string | null
}

export type ParseError = { row: number; reason: string }

export type ParseResult = { lines: ParsedLine[]; errors: ParseError[] }

export type DateFormat = 'YMD' | 'MDY' | 'DMY'

export type CsvMapping = {
  dateColumn: number
  dateFormat: DateFormat
  descriptionColumn: number
  amount: { mode: 'signed'; column: number; flip: boolean } | { mode: 'inout'; inColumn: number; outColumn: number }
}

const AMOUNT = /^(-)?(\d+)(?:\.(\d{1,2}))?$/

/**
 * "1,234.5" / "$12.00" / "(12.50)" / "-3" → signed two-decimal string, or null when unreadable
 * (including comma-decimal amounts such as "12,50").
 * Zero comes back as "0.00"; callers decide whether that is allowed.
 */
export function normaliseAmount(raw: string): string | null {
  // A comma used as the decimal mark ("12,50", "1.234,5") would otherwise read 100x too large:
  // refuse it unless it is a thousands separator (exactly three digits after it, and before any dot).
  const lastComma = raw.lastIndexOf(',')
  if (lastComma >= 0 && lastComma > raw.lastIndexOf('.') && !/^,\d{3}(\D*)$/.test(raw.slice(lastComma))) return null
  let v = raw.trim().replace(/[$£€\s,]/g, '')
  let neg = false
  const paren = /^\((.*)\)$/.exec(v)
  if (paren) {
    neg = true
    v = paren[1]
  }
  if (v.startsWith('+')) v = v.slice(1)
  const m = AMOUNT.exec(v)
  if (!m) return null
  if (m[1]) neg = !neg
  const whole = String(Number(m[2]))
  const cents = (m[3] ?? '').padEnd(2, '0')
  const isZero = Number(whole) === 0 && Number(cents) === 0
  return `${neg && !isZero ? '-' : ''}${whole}.${cents}`
}

export function negate(amount: string): string {
  return amount.startsWith('-') ? amount.slice(1) : amount === '0.00' ? amount : `-${amount}`
}

export function isIsoDay(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1) return null
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d > last) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
