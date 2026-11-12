import { ok, type Result } from '@/lib/result'
import { isIsoDay, negate, normaliseAmount, type CsvMapping, type DateFormat, type ParseResult } from './types'

/** RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF, leading BOM. Blank lines are dropped. */
export function readCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f !== '')) rows.push(row)
  return rows
}

function parseDate(raw: string, format: DateFormat): string | null {
  const parts = raw.trim().split(/[-/.]/).map((p) => p.trim())
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null
  const n = parts.map(Number)
  const [y, m, d] = format === 'YMD' ? n : format === 'MDY' ? [n[2], n[0], n[1]] : [n[2], n[1], n[0]]
  const year = (format === 'YMD' ? parts[0] : parts[2]).length === 2 ? 2000 + y : y
  return isIsoDay(year, m, d)
}

/** Header row is skipped; error rows are numbered from 1 counting the header. */
export function parseCsv(text: string, mapping: CsvMapping): Result<ParseResult> {
  const rows = readCsv(text).slice(1)
  const out: ParseResult = { lines: [], errors: [] }
  rows.forEach((cells, i) => {
    const row = i + 2
    const date = parseDate(cells[mapping.dateColumn] ?? '', mapping.dateFormat)
    if (!date) {
      out.errors.push({ row, reason: "The date doesn't match the chosen format." })
      return
    }
    let amount: string | null
    if (mapping.amount.mode === 'signed') {
      amount = normaliseAmount(cells[mapping.amount.column] ?? '')
      if (amount && mapping.amount.flip) amount = negate(amount)
    } else {
      const inV = normaliseAmount(cells[mapping.amount.inColumn] ?? '')
      const outV = normaliseAmount(cells[mapping.amount.outColumn] ?? '')
      const hasIn = inV !== null && inV !== '0.00'
      const hasOut = outV !== null && outV !== '0.00'
      amount = hasIn && !hasOut ? inV!.replace(/^-/, '') : hasOut && !hasIn ? negate(outV!.replace(/^-/, '')) : null
    }
    if (!amount || amount === '0.00') {
      out.errors.push({ row, reason: 'The amount is zero or missing.' })
      return
    }
    const description = (cells[mapping.descriptionColumn] ?? '').trim()
    out.lines.push({
      postedOn: date,
      amount,
      description: description.slice(0, 500) || '(no description)',
      bankRef: null,
    })
  })
  return ok(out)
}
