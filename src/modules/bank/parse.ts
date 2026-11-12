import { fail, ok, type Result } from '@/lib/result'
import { parseCsv } from './csv'
import { parseOfx } from './ofx'
import type { CsvMapping, ParseResult } from './types'

export const MAX_LINES = 5000

export function statementFormat(fileName: string): 'ofx' | 'csv' | null {
  const ext = fileName.toLowerCase().split('.').pop()
  return ext === 'ofx' || ext === 'qfx' ? 'ofx' : ext === 'csv' ? 'csv' : null
}

export function parseStatement(
  fileName: string,
  text: string,
  mapping: CsvMapping | null,
): Result<ParseResult & { format: 'ofx' | 'csv' }> {
  const format = statementFormat(fileName)
  if (!format) return fail('Upload an OFX, QFX or CSV file.')
  if (format === 'csv' && !mapping) return fail('Choose which columns hold the date, description and amount.')
  const parsed = format === 'ofx' ? parseOfx(text) : parseCsv(text, mapping!)
  if (!parsed.ok) return parsed
  const { lines, errors } = parsed.data
  if (lines.length > MAX_LINES) return fail('This file has more than 5,000 transactions. Split it and upload the parts.')
  if (lines.length === 0 && errors.length === 0) return fail('No transactions found in this file.')
  return ok({ lines, errors, format })
}
