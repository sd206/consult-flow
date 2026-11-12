import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanDescription } from './clean'
import { parseCsv, readCsv } from './csv'
import { dedupeKeys } from './dedupe'
import { parseOfx } from './ofx'
import { parseStatement } from './parse'
import type { CsvMapping, ParsedLine } from './types'

const fixture = (name: string) => readFileSync(path.resolve(__dirname, '../../../tests/fixtures/bank', name), 'utf8')

const OFX_EXPECTED: ParsedLine[] = [
  { postedOn: '2026-11-02', amount: '1500.00', description: 'GLOBEX CORP PAYMENT – ACH CREDIT', bankRef: '2026110201' },
  { postedOn: '2026-11-03', amount: '-129.99', description: 'AWS EMEA', bankRef: '2026110302' },
  { postedOn: '2026-11-04', amount: '-500.00', description: 'TRANSFER TO SAVINGS', bankRef: '2026110403' },
]

const signed = (flip: boolean): CsvMapping => ({
  dateColumn: 0,
  dateFormat: 'MDY',
  descriptionColumn: 1,
  amount: { mode: 'signed', column: 2, flip },
})

const inout: CsvMapping = {
  dateColumn: 0,
  dateFormat: 'DMY',
  descriptionColumn: 1,
  amount: { mode: 'inout', inColumn: 2, outColumn: 3 },
}

function ok<T>(r: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.data
}

describe('OFX/QFX', () => {
  it('reads an SGML QFX file', () => {
    const r = ok(parseOfx(fixture('sample-sgml.qfx')))
    expect(r.lines).toEqual(OFX_EXPECTED)
    expect(r.errors).toEqual([])
  })

  it('reads an XML OFX file the same way', () => {
    expect(ok(parseOfx(fixture('sample-xml.ofx'))).lines).toEqual(OFX_EXPECTED)
  })

  it('rejects text that is not OFX', () => {
    expect(parseOfx('hello').ok).toBe(false)
  })
})

describe('CSV', () => {
  it('reads quoted fields, doubled quotes, embedded newlines and a BOM', () => {
    expect(readCsv('﻿a,"b, c","say ""hi""","line\nbreak"\r\nx,y,,z\n')).toEqual([
      ['a', 'b, c', 'say "hi"', 'line\nbreak'],
      ['x', 'y', '', 'z'],
    ])
  })

  it('flips positive card purchases into money out', () => {
    const r = ok(parseCsv(fixture('card-positive.csv'), signed(true)))
    expect(r.lines.map((l) => [l.postedOn, l.amount, l.description])).toEqual([
      ['2026-11-02', '-412.37', 'DELTA AIR LINES, ATLANTA'],
      ['2026-11-03', '-38.50', 'UBER *TRIP HELP.UBER.COM'],
      ['2026-11-03', '-38.50', 'UBER *TRIP HELP.UBER.COM'],
      ['2026-11-04', '800.00', 'PAYMENT THANK YOU'],
    ])
    expect(r.lines.every((l) => l.bankRef === null)).toBe(true)
    expect(ok(parseCsv(fixture('card-positive.csv'), signed(false))).lines[0].amount).toBe('412.37')
  })

  it('reads money in / money out columns, thousands separators and currency signs; reports bad rows', () => {
    const r = ok(parseCsv(fixture('inout.csv'), inout))
    expect(r.lines.map((l) => [l.postedOn, l.amount, l.description])).toEqual([
      ['2026-11-05', '1234.50', 'Interest paid'],
      ['2026-11-06', '-12.00', 'Coffee "Bean" Co'],
    ])
    expect(r.errors).toEqual([
      { row: 4, reason: 'The amount is zero or missing.' },
      { row: 5, reason: "The date doesn't match the chosen format." },
    ])
  })

  it('handles the three date formats and rejects impossible dates', () => {
    const csv = (d: string) => `Date,Desc,Amt\n${d},X,1.00\n`
    const fmt = (dateFormat: CsvMapping['dateFormat']) => ({ ...signed(false), dateFormat })
    expect(ok(parseCsv(csv('2026-02-03'), fmt('YMD'))).lines[0].postedOn).toBe('2026-02-03')
    expect(ok(parseCsv(csv('2/3/2026'), fmt('MDY'))).lines[0].postedOn).toBe('2026-02-03')
    expect(ok(parseCsv(csv('03/02/2026'), fmt('DMY'))).lines[0].postedOn).toBe('2026-02-03')
    expect(ok(parseCsv(csv('13/25/2026'), fmt('MDY'))).errors).toHaveLength(1)
    expect(ok(parseCsv(csv('02/30/2026'), fmt('MDY'))).errors).toHaveLength(1)
  })

  it('reads negatives in parentheses', () => {
    expect(ok(parseCsv('D,X,A\n2026-01-02,Fee,(12.5)\n', { ...signed(false), dateFormat: 'YMD' })).lines[0].amount).toBe(
      '-12.50',
    )
  })
})

describe('cleanDescription', () => {
  it('drops terminal noise and normalises', () => {
    expect(cleanDescription('AMZN Mktp US*2K4LL9 ')).toBe('AMZN MKTP US')
    expect(cleanDescription('  Starbucks   #1234  11/04 ')).toBe('STARBUCKS')
    expect(cleanDescription('UBER *TRIP HELP.UBER.COM')).toBe('UBER *TRIP HELP.UBER.COM')
    expect(cleanDescription('=HYPERLINK(1)')).toBe('=HYPERLINK(1)')
    expect(cleanDescription('x'.repeat(100))).toHaveLength(80)
  })
})

describe('dedupeKeys', () => {
  it('uses the bank id when there is one', () => {
    expect(dedupeKeys(OFX_EXPECTED)[0]).toBe('fitid:2026110201')
  })

  it('gives identical rows different keys, and the same keys on re-upload and in overlapping files', () => {
    const card = ok(parseCsv(fixture('card-positive.csv'), signed(true))).lines
    const keys = dedupeKeys(card)
    expect(new Set(keys).size).toBe(4)
    expect(dedupeKeys(card)).toEqual(keys)
    // An overlapping export: the last two rows again plus a new one.
    const overlap = dedupeKeys([card[1], card[2], { ...card[0], postedOn: '2026-11-09' }])
    expect(overlap.slice(0, 2)).toEqual(keys.slice(1, 3))
    expect(keys).not.toContain(overlap[2])
  })
})

describe('parseStatement', () => {
  it('picks the format from the file name', () => {
    expect(ok(parseStatement('jan.QFX', fixture('sample-sgml.qfx'), null)).format).toBe('ofx')
    expect(ok(parseStatement('jan.csv', fixture('card-positive.csv'), signed(true))).format).toBe('csv')
  })

  it('needs a mapping for CSV, and refuses unknown types, empty files and over 5,000 lines', () => {
    expect(parseStatement('a.csv', 'x', null)).toEqual({ ok: false, error: 'Choose which columns hold the date, description and amount.' })
    expect(parseStatement('a.pdf', 'x', null)).toEqual({ ok: false, error: 'Upload an OFX, QFX or CSV file.' })
    expect(parseStatement('a.csv', 'Date,Desc,Amt\n', signed(false))).toEqual({ ok: false, error: 'No transactions found in this file.' })
    const big = `Date,Desc,Amt\n${'01/02/2026,X,1.00\n'.repeat(5001)}`
    expect(parseStatement('a.csv', big, signed(false))).toEqual({
      ok: false,
      error: 'This file has more than 5,000 transactions. Split it and upload the parts.',
    })
  })
})
