import { describe, expect, it } from 'vitest'
import { buildPnlCsv } from './pnl-csv'
import type { PnlParams, PnlRow } from './pnl'

const params: PnlParams = {
  from: '2026-03-01',
  to: '2026-05-31',
  group: 'month',
  clientIds: null,
  projectIds: null,
  split: { client: false, project: false },
}

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
    clientLabel: null,
    projectLabel: null,
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

  it('prefixes a leading tab or carriage return, and quotes embedded line feeds', () => {
    const raw = buildPnlCsv(
      [mk({ label: '\tTabbed' }), mk({ label: '\rReturn' }), mk({ label: 'Line\nBreak' })],
      params,
    ).body
    expect(raw).toContain("\r\n'\tTabbed,2300.00")
    // A leading CR gets the apostrophe and, being a CR, the field is quoted.
    expect(raw).toContain('\r\n"\'\rReturn",2300.00')
    expect(raw).toContain('\r\n"Line\nBreak",2300.00')
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

  it('marks a filtered export in the filename', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(buildPnlCsv([], { ...params, clientIds: [id] }).filename).toBe(
      'pnl-2026-03-01-to-2026-05-31-by-month-filtered.csv',
    )
    expect(buildPnlCsv([], { ...params, group: 'client', projectIds: [id] }).filename).toBe(
      'pnl-2026-03-01-to-2026-05-31-by-client-filtered.csv',
    )
    expect(buildPnlCsv([], { ...params, clientIds: [] }).filename).toBe('pnl-2026-03-01-to-2026-05-31-by-month.csv')
  })

  describe('breakdown columns', () => {
    const HEAD_REST =
      'Revenue from hours,Fees,Discounts,Revenue,Labour cost,Gross profit,Direct expenses,Overhead,Net profit,Margin %,Invoiced,Collected'
    const monthClient: PnlParams = { ...params, split: { client: true, project: false } }

    it('adds a Client column after Group for a client split, with details then the subtotal', () => {
      const rows = [
        mk({ kind: 'detail', label: 'Mar 2026', clientLabel: 'Globex', revenue: '1500.00' }),
        mk({ kind: 'detail', label: 'Mar 2026', clientLabel: 'Initech', revenue: '800.00' }),
        mk({ kind: 'subtotal', label: 'Mar 2026 subtotal' }),
        mk({ kind: 'detail', label: 'Apr 2026', clientLabel: 'Overhead', revenue: '0.00' }),
        mk({ kind: 'subtotal', label: 'Apr 2026 subtotal' }),
        mk({ kind: 'total', label: 'Total' }),
      ]
      const l = lines(buildPnlCsv(rows, monthClient).body)
      expect(l[0]).toBe(`Group,Client,${HEAD_REST}`)
      expect(l.slice(1, 7).map((x) => x.split(',').slice(0, 2).join(','))).toEqual([
        'Mar 2026,Globex',
        'Mar 2026,Initech',
        'Mar 2026 subtotal,',
        'Apr 2026,Overhead',
        'Apr 2026 subtotal,',
        'Total,',
      ])
      expect(l[1].split(',')[5]).toBe('1500.00')
      expect(l[1].split(',')).toHaveLength(14)
    })

    it('adds Client and Project columns for a project split', () => {
      const rows = [
        mk({ kind: 'detail', label: 'Globex', clientLabel: 'Globex', projectLabel: 'Portal' }),
        mk({ kind: 'detail', label: 'Globex', clientLabel: 'Globex', projectLabel: 'no project' }),
        mk({ kind: 'subtotal', label: 'Globex subtotal' }),
        mk({ kind: 'overhead', label: 'x' }),
      ]
      const l = lines(buildPnlCsv(rows, { ...params, split: { client: true, project: true } }).body)
      expect(l[0]).toBe(`Group,Client,Project,${HEAD_REST}`)
      expect(l.slice(1, 5).map((x) => x.split(',').slice(0, 3).join(','))).toEqual([
        'Globex,Globex,Portal',
        'Globex,Globex,no project',
        'Globex subtotal,,',
        'Unallocated overhead,,',
      ])
    })

    it('adds only a Project column under client grouping with a project split', () => {
      const p: PnlParams = { ...params, group: 'client', split: { client: false, project: true } }
      const l = lines(
        buildPnlCsv([mk({ kind: 'detail', label: 'Globex', clientLabel: 'Globex', projectLabel: 'Portal' })], p).body,
      )
      expect(l[0]).toBe(`Group,Project,${HEAD_REST}`)
      expect(l[1].startsWith('Globex,Portal,')).toBe(true)
    })

    it('always has Client and Project columns under project grouping, Group blank on project rows', () => {
      const p: PnlParams = { ...params, group: 'project' }
      const rows = [
        mk({ kind: 'group', label: 'Globex — Portal', clientLabel: 'Globex', projectLabel: 'Portal' }),
        mk({ kind: 'overhead', label: 'x' }),
        mk({ kind: 'total', label: 'y' }),
      ]
      const l = lines(buildPnlCsv(rows, p).body)
      expect(l[0]).toBe(`Group,Client,Project,${HEAD_REST}`)
      expect(l[1].startsWith(',Globex,Portal,2300.00')).toBe(true)
      expect(l[2].startsWith('Unallocated overhead,,,')).toBe(true)
      expect(l[3].startsWith('Total,,,')).toBe(true)
    })

    it('guards formula injection in client and project labels', () => {
      const rows = [mk({ kind: 'detail', clientLabel: '=cmd()', projectLabel: '+1, "x"' })]
      const l = lines(buildPnlCsv(rows, { ...params, split: { client: true, project: true } }).body)
      expect(l[1].startsWith(`Mar 2026,'=cmd(),"'+1, ""x""",2300.00`)).toBe(true)
    })

    it('names the file after the split, keeping the filtered suffix', () => {
      const id = '11111111-1111-4111-8111-111111111111'
      expect(buildPnlCsv([], monthClient).filename).toBe('pnl-2026-03-01-to-2026-05-31-by-month-with-client.csv')
      expect(buildPnlCsv([], { ...params, group: 'quarter', split: { client: true, project: true } }).filename).toBe(
        'pnl-2026-03-01-to-2026-05-31-by-quarter-with-client-project.csv',
      )
      expect(buildPnlCsv([], { ...monthClient, clientIds: [id] }).filename).toBe(
        'pnl-2026-03-01-to-2026-05-31-by-month-with-client-filtered.csv',
      )
      expect(
        buildPnlCsv([], { ...params, group: 'client', split: { client: false, project: true } }).filename,
      ).toBe('pnl-2026-03-01-to-2026-05-31-by-client-with-project.csv')
      expect(buildPnlCsv([], { ...params, group: 'project' }).filename).toBe('pnl-2026-03-01-to-2026-05-31-by-project.csv')
    })
  })
})
