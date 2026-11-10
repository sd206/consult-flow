import { describe, expect, it } from 'vitest'
import { buildPnlCsv } from './pnl-csv'
import type { PnlParams, PnlRow } from './pnl'

const params: PnlParams = { from: '2026-03-01', to: '2026-05-31', group: 'month', clientIds: null, projectIds: null }

function mk(over: Partial<PnlRow> = {}): PnlRow {
  return {
    kind: 'group',
    key: 'k',
    label: 'Mar 2026',
    revenueHours: '2300.00',
    fees: '0.00',
    discounts: '0.00',
    revenue: '2300.00',
    labour: '1380.00',
    gross: '920.00',
    directExpenses: '180.00',
    overhead: '0.00',
    net: '740.00',
    margin: '32.2',
    invoiced: '0.00',
    collected: '0.00',
    ...over,
  }
}

const lines = (body: string) => body.replace(/^\uFEFF/, '').split('\r\n')

describe('buildPnlCsv', () => {
  it('starts with BOM, uses CRLF, has the header and a trailing CRLF', () => {
    const { body } = buildPnlCsv([mk()], params)
    expect(body.startsWith('\uFEFF')).toBe(true)
    expect(body.endsWith('\r\n')).toBe(true)
    const l = lines(body)
    expect(l[0]).toBe(
      'Group,Revenue from hours,Fees,Discounts,Revenue,Labour cost,Gross profit,Direct expenses,Overhead,Net profit,Margin %,Invoiced,Collected',
    )
    expect(l[1]).toBe('Mar 2026,2300.00,0.00,0.00,2300.00,1380.00,920.00,180.00,0.00,740.00,32.2,0.00,0.00')
    expect(l[2]).toBe('')
  })

  it('quotes commas and doubles quotes', () => {
    const l = lines(buildPnlCsv([mk({ label: 'Acme, Inc' }), mk({ label: 'Say "hi"' })], params).body)
    expect(l[1].startsWith('"Acme, Inc",')).toBe(true)
    expect(l[2].startsWith('"Say ""hi""",')).toBe(true)
  })

  it('neutralises formula injection in text cells', () => {
    const l = lines(buildPnlCsv([mk({ label: '=HYPERLINK("x")' })], params).body)
    expect(l[1].startsWith(`"'=HYPERLINK(""x"")",`)).toBe(true)
  })

  it('prefixes a leading dash in text but not in numbers', () => {
    const l = lines(buildPnlCsv([mk({ label: '-Odd', net: '-75.00' })], params).body)
    expect(l[1].startsWith("'-Odd,")).toBe(true)
    expect(l[1].split(',')[9]).toBe('-75.00')
  })

  it('emits an empty cell for null margin', () => {
    const l = lines(buildPnlCsv([mk({ margin: null })], params).body)
    expect(l[1].split(',')[10]).toBe('')
  })

  it('labels overhead and total rows fixedly', () => {
    const l = lines(buildPnlCsv([mk({ kind: 'overhead', label: 'x' }), mk({ kind: 'total', label: 'y' })], params).body)
    expect(l[1].startsWith('Unallocated overhead,')).toBe(true)
    expect(l[2].startsWith('Total,')).toBe(true)
  })

  it('names the file', () => {
    expect(buildPnlCsv([], params).filename).toBe('pnl-2026-03-01-to-2026-05-31-by-month.csv')
  })
})
