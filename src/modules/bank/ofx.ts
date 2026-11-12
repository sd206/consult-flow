import { fail, ok, type Result } from '@/lib/result'
import { isIsoDay, normaliseAmount, type ParseResult } from './types'

const NOT_OFX = "This doesn't look like an OFX or QFX file."

/** Value of a tag inside one STMTTRN block; works for SGML (no closing tags) and XML. */
function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block)
  if (!m) return null
  const v = decode(m[1].trim())
  return v === '' ? null : v
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export function parseOfx(text: string): Result<ParseResult> {
  if (!/<OFX>/i.test(text)) return fail(NOT_OFX)
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0])
  const out: ParseResult = { lines: [], errors: [] }
  blocks.forEach((block, i) => {
    const row = i + 1
    const dt = tag(block, 'DTPOSTED')
    const date = dt && /^\d{8}/.test(dt) ? isIsoDay(Number(dt.slice(0, 4)), Number(dt.slice(4, 6)), Number(dt.slice(6, 8))) : null
    if (!date) {
      out.errors.push({ row, reason: 'The transaction date is missing or unreadable.' })
      return
    }
    const amount = normaliseAmount(tag(block, 'TRNAMT') ?? '')
    if (!amount || amount === '0.00') {
      out.errors.push({ row, reason: 'The amount is zero or missing.' })
      return
    }
    const name = tag(block, 'NAME')
    const memo = tag(block, 'MEMO')
    const description = name && memo && memo !== name ? `${name} – ${memo}` : (name ?? memo ?? '')
    out.lines.push({
      postedOn: date,
      amount,
      description: description.slice(0, 500) || '(no description)',
      bankRef: tag(block, 'FITID'),
    })
  })
  return ok(out)
}
