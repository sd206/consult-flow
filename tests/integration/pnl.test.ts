import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { getPnl } from '@/modules/reports/pnl'
import { newFirm } from './helpers'
import { seedPnlScenario, type PnlIds } from './pnl-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>

type PnlRow = {
  row_kind: string
  group_key: string
  label: string
  sort_key: string | null
  revenue_hours: string
  fees: string
  discounts: string
  revenue: string
  labour: string
  gross: string
  direct_expenses: string
  overhead: string
  net: string
  margin: string | null
  invoiced: string
  collected: string
}

type FactRow = { fact_date: string; client_id: string | null; project_id: string | null; measure: string; amount: number }

const MONEY = [
  'revenue_hours',
  'fees',
  'discounts',
  'revenue',
  'labour',
  'gross',
  'direct_expenses',
  'overhead',
  'net',
  'invoiced',
  'collected',
] as const

function call(
  db: SupabaseClient,
  firmId: string,
  from: string,
  to: string,
  group: string,
  filters: { clients?: string[] | null; projects?: string[] | null } = {},
) {
  return db.rpc('pnl_report', {
    p_firm: firmId,
    p_from: from,
    p_to: to,
    p_group: group,
    p_clients: filters.clients ?? null,
    p_projects: filters.projects ?? null,
  })
}

async function report(
  db: SupabaseClient,
  firmId: string,
  from: string,
  to: string,
  group: string,
  filters: { clients?: string[] | null; projects?: string[] | null } = {},
): Promise<PnlRow[]> {
  const { data, error } = await call(db, firmId, from, to, group, filters)
  if (error) throw new Error(`pnl_report failed: ${error.message}`)
  return data as PnlRow[]
}

function row(rows: PnlRow[], label: string): PnlRow {
  const r = rows.find((x) => x.label === label)
  if (!r) throw new Error(`no row ${label} in ${rows.map((x) => x.label).join(', ')}`)
  return r
}

function errorText(error: { message?: string; details?: string } | null): string {
  return `${error?.message ?? ''} ${error?.details ?? ''}`
}

describe('pnl_report', () => {
  let f: Firm
  let ids: PnlIds

  beforeAll(async () => {
    f = await newFirm('PnL Firm')
    ids = await seedPnlScenario(f)
  }, 60_000)

  describe('by month', () => {
    let rows: PnlRow[]
    beforeAll(async () => {
      rows = await report(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'month')
    })

    it('has one row per month, then the total', () => {
      expect(rows.map((r) => [r.row_kind, r.group_key, r.label, r.sort_key])).toEqual([
        ['group', '2026-03-01', 'Mar 2026', '2026-03'],
        ['group', '2026-04-01', 'Apr 2026', '2026-04'],
        ['group', '2026-05-01', 'May 2026', '2026-05'],
        ['total', 'total', 'Total', null],
      ])
    })

    it('March', () => {
      expect(row(rows, 'Mar 2026')).toMatchObject({
        revenue_hours: '2300.00',
        fees: '0.00',
        discounts: '0.00',
        revenue: '2300.00',
        labour: '1380.00',
        gross: '920.00',
        direct_expenses: '180.00',
        overhead: '0.00',
        net: '740.00',
        margin: '32.2',
        invoiced: '0.00',
        collected: '0.00',
      })
    })

    it('April', () => {
      expect(row(rows, 'Apr 2026')).toMatchObject({
        revenue_hours: '0.00',
        fees: '300.00',
        discounts: '180.00',
        revenue: '120.00',
        labour: '0.00',
        gross: '120.00',
        direct_expenses: '0.00',
        overhead: '75.00',
        net: '45.00',
        margin: '37.5',
        invoiced: '1620.00',
        collected: '0.00',
      })
    })

    it('May', () => {
      expect(row(rows, 'May 2026')).toMatchObject({
        revenue: '0.00',
        net: '0.00',
        margin: null,
        invoiced: '0.00',
        collected: '923.79',
      })
    })

    it('Total', () => {
      expect(row(rows, 'Total')).toMatchObject({
        revenue: '2420.00',
        labour: '1380.00',
        gross: '1040.00',
        direct_expenses: '180.00',
        overhead: '75.00',
        net: '785.00',
        margin: '32.4',
        invoiced: '1620.00',
        collected: '923.79',
      })
    })
  })

  describe('by client', () => {
    let rows: PnlRow[]
    beforeAll(async () => {
      rows = await report(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'client')
    })

    it('orders clients by name, then overhead, then total', () => {
      expect(rows.map((r) => [r.row_kind, r.group_key, r.label])).toEqual([
        ['group', ids.globexId, 'Globex'],
        ['group', ids.initechId, 'Initech'],
        ['overhead', 'overhead', 'Unallocated overhead'],
        ['total', 'total', 'Total'],
      ])
    })

    it('Globex', () => {
      expect(row(rows, 'Globex')).toMatchObject({
        revenue_hours: '1500.00',
        fees: '300.00',
        discounts: '180.00',
        revenue: '1620.00',
        labour: '900.00',
        gross: '720.00',
        direct_expenses: '120.00',
        overhead: '0.00',
        net: '600.00',
        margin: '37.0',
        invoiced: '1620.00',
        collected: '923.79',
      })
    })

    it('Initech', () => {
      expect(row(rows, 'Initech')).toMatchObject({
        revenue: '800.00',
        labour: '480.00',
        gross: '320.00',
        direct_expenses: '60.00',
        overhead: '0.00',
        net: '260.00',
        margin: '32.5',
        invoiced: '0.00',
      })
    })

    it('Unallocated overhead and Total', () => {
      expect(row(rows, 'Unallocated overhead')).toMatchObject({ overhead: '75.00', net: '-75.00', revenue: '0.00', margin: null })
      expect(row(rows, 'Total')).toMatchObject({ net: '785.00' })
    })
  })

  describe('by project', () => {
    let rows: PnlRow[]
    beforeAll(async () => {
      rows = await report(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'project')
    })

    it('orders by client then project, no-project last per client', () => {
      expect(rows.map((r) => [r.row_kind, r.group_key, r.label])).toEqual([
        ['group', ids.portalId, 'Globex — Portal'],
        ['group', `client:${ids.globexId}`, 'Globex — no project'],
        ['group', ids.auditId, 'Initech — Audit'],
        ['group', `client:${ids.initechId}`, 'Initech — no project'],
        ['overhead', 'overhead', 'Unallocated overhead'],
        ['total', 'total', 'Total'],
      ])
    })

    it('values', () => {
      expect(row(rows, 'Globex — Portal')).toMatchObject({
        revenue: '1500.00',
        labour: '900.00',
        direct_expenses: '120.00',
        net: '480.00',
      })
      expect(row(rows, 'Globex — no project')).toMatchObject({
        fees: '300.00',
        discounts: '180.00',
        revenue: '120.00',
        net: '120.00',
        invoiced: '1620.00',
        collected: '923.79',
      })
      expect(row(rows, 'Initech — Audit')).toMatchObject({ revenue: '800.00', labour: '480.00', net: '320.00' })
      expect(row(rows, 'Initech — no project')).toMatchObject({ direct_expenses: '60.00', net: '-60.00' })
      expect(row(rows, 'Unallocated overhead')).toMatchObject({ net: '-75.00' })
      expect(row(rows, 'Total')).toMatchObject({ net: '785.00' })
    })
  })

  it('by quarter', async () => {
    const rows = await report(f.manager.db, f.firmId, '2026-01-01', '2026-06-30', 'quarter')
    const groups = rows.filter((r) => r.row_kind === 'group')
    expect(groups.map((r) => [r.group_key, r.label])).toEqual([
      ['2026-01-01', '2026 Q1'],
      ['2026-04-01', '2026 Q2'],
    ])
    expect(row(rows, '2026 Q1').revenue).toBe('2300.00')
    expect(row(rows, '2026 Q2')).toMatchObject({ revenue: '120.00', collected: '923.79' })
  })

  it('client filter drops overhead', async () => {
    const rows = await report(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'month', { clients: [ids.globexId] })
    expect(rows.some((r) => r.row_kind === 'overhead')).toBe(false)
    expect(row(rows, 'Apr 2026').overhead).toBe('0.00')
    expect(row(rows, 'Mar 2026').revenue).toBe('1500.00')
    expect(row(rows, 'Total').overhead).toBe('0.00')

    const byClient = await report(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'client', {
      clients: [ids.globexId],
    })
    expect(byClient.map((r) => r.label)).toEqual(['Globex', 'Total'])
  })

  it('project filter keeps only that project', async () => {
    const rows = await report(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'month', {
      projects: [ids.portalId],
    })
    expect(row(rows, 'Apr 2026').revenue).toBe('0.00')
    expect(row(rows, 'Mar 2026')).toMatchObject({ revenue: '1500.00', labour: '900.00', direct_expenses: '120.00' })
    expect(row(rows, 'Total')).toMatchObject({
      revenue: '1500.00',
      overhead: '0.00',
      invoiced: '0.00',
      collected: '0.00',
      net: '480.00',
    })
  })

  it('includes empty months', async () => {
    const rows = await report(f.manager.db, f.firmId, '2026-01-01', '2026-05-31', 'month')
    expect(rows.filter((r) => r.row_kind === 'group')).toHaveLength(5)
    for (const label of ['Jan 2026', 'Feb 2026']) {
      const r = row(rows, label)
      for (const k of MONEY) expect(r[k]).toBe('0.00')
      expect(r.margin).toBeNull()
    }
  })

  describe('errors and access', () => {
    it('rejects an unknown grouping', async () => {
      const { error } = await call(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'week')
      expect(errorText(error)).toContain('PNL_GROUP_INVALID')
    })

    it('rejects a reversed or over-long range', async () => {
      const reversed = await call(f.manager.db, f.firmId, '2026-05-01', '2026-04-30', 'month')
      expect(errorText(reversed.error)).toContain('PNL_RANGE_INVALID')
      const long = await call(f.manager.db, f.firmId, '2023-01-01', '2026-01-02', 'month')
      expect(errorText(long.error)).toContain('PNL_RANGE_INVALID')
      const exact = await call(f.manager.db, f.firmId, '2023-01-01', '2026-01-01', 'quarter')
      expect(exact.error).toBeNull()
    })

    it('admins may run it', async () => {
      const rows = await report(f.admin.db, f.firmId, '2026-03-01', '2026-05-31', 'month')
      expect(row(rows, 'Total').net).toBe('785.00')
    })

    it('consultants get 42501', async () => {
      const { error } = await call(f.consultant.db, f.firmId, '2026-03-01', '2026-05-31', 'month')
      expect(error?.code).toBe('42501')
      const facts = await f.consultant.db.rpc('pnl_facts', { p_firm: f.firmId, p_from: '2026-03-01', p_to: '2026-05-31' })
      expect(facts.error?.code).toBe('42501')
    })

    it("another firm's manager gets 42501", async () => {
      const other = await newFirm('Other PnL Firm')
      const { error } = await call(other.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'month')
      expect(error?.code).toBe('42501')
      const facts = await other.manager.db.rpc('pnl_facts', { p_firm: f.firmId, p_from: '2026-03-01', p_to: '2026-05-31' })
      expect(facts.error?.code).toBe('42501')
    })
  })

  describe('pnl_facts', () => {
    let facts: FactRow[]
    beforeAll(async () => {
      const { data, error } = await f.manager.db.rpc('pnl_facts', {
        p_firm: f.firmId,
        p_from: '2026-03-01',
        p_to: '2026-03-31',
      })
      if (error) throw new Error(error.message)
      facts = data as FactRow[]
    })

    const cents = (measure: string) =>
      facts.filter((x) => x.measure === measure).reduce((s, x) => s + Math.round(Number(x.amount) * 100), 0)

    it('March revenue_hours sum to 2300 (unapproved week excluded)', () => {
      expect(cents('revenue_hours')).toBe(230000)
      expect(cents('labour')).toBe(138000)
    })

    it('only returns facts within the range', () => {
      expect(facts.every((x) => x.fact_date >= '2026-03-01' && x.fact_date <= '2026-03-31')).toBe(true)
      expect(facts.some((x) => x.measure === 'collected')).toBe(false)
    })

    it('collected is rounded per payment', async () => {
      const { data, error } = await f.manager.db.rpc('pnl_facts', {
        p_firm: f.firmId,
        p_from: '2026-05-01',
        p_to: '2026-05-31',
      })
      if (error) throw new Error(error.message)
      const collected = (data as FactRow[]).filter((x) => x.measure === 'collected')
      expect(collected).toHaveLength(1)
      expect(Number(collected[0].amount)).toBe(923.79)
      expect(collected[0]).toMatchObject({ client_id: ids.globexId, project_id: null, fact_date: '2026-05-05' })
    })
  })
})

describe('pnl_report: reopened timesheets', () => {
  it('drops reopened hours and restores them on re-approval', async () => {
    // Without invoices, so the March weeks are uninvoiced and can be reopened.
    const f = await newFirm('PnL Reopen Firm')
    const ids = await seedPnlScenario(f, { invoices: false })
    const march = async () =>
      row(await report(f.manager.db, f.firmId, '2026-03-01', '2026-03-31', 'month'), 'Mar 2026').revenue_hours

    expect(await march()).toBe('2300.00')

    for (const t of [ids.danaWeekId, ids.leeWeekId]) {
      const { error } = await f.manager.db.rpc('reopen_timesheet', { p_timesheet: t })
      if (error) throw new Error(error.message)
    }
    expect(await march()).toBe('0.00')

    for (const t of [ids.danaWeekId, ids.leeWeekId]) {
      const sub = await f.manager.db.rpc('submit_timesheet', { p_timesheet: t })
      if (sub.error) throw new Error(sub.error.message)
      const app = await f.manager.db.rpc('approve_timesheet', { p_timesheet: t })
      if (app.error) throw new Error(app.error.message)
    }
    expect(await march()).toBe('2300.00')
  }, 60_000)
})

describe('getPnl', () => {
  it('maps the March row and rejects consultants', async () => {
    const f = await newFirm('PnL Data Firm')
    await seedPnlScenario(f)
    const params = { from: '2026-03-01', to: '2026-05-31', group: 'month' as const, clientIds: null, projectIds: null }
    const res = await getPnl(f.manager.db, f.firmId, params)
    if (!res.ok) throw new Error(res.error)
    expect(res.data.find((r) => r.label === 'Mar 2026')).toMatchObject({
      kind: 'group',
      revenueHours: '2300.00',
      labour: '1380.00',
      net: '740.00',
      margin: '32.2',
    })
    expect(res.data.at(-1)).toMatchObject({ kind: 'total', net: '785.00' })

    const denied = await getPnl(f.consultant.db, f.firmId, params)
    expect(denied).toEqual({ ok: false, error: "You don't have permission to do that." })
  }, 60_000)
})
