import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { getPnl } from '@/modules/reports/pnl'
import { newFirm } from './helpers'
import { defaultTemplate, insertOne, rpc, saveAndSubmit, seedPnlScenario, type PnlIds } from './pnl-fixtures'

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
    const params = {
      from: '2026-03-01',
      to: '2026-05-31',
      group: 'month' as const,
      clientIds: null,
      projectIds: null,
      split: { client: false, project: false },
    }
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

describe('pnl_report: margin on non-positive revenue', () => {
  it('is null when displayed revenue is negative or zero', async () => {
    // Hours-only invoice with a 10% discount: the discount has no project and no
    // fees to offset it, so "Globex — no project" and April have negative revenue.
    const f = await newFirm('PnL Margin Firm')
    const ids = await seedPnlScenario(f, { invoices: false })
    const template = await defaultTemplate(f.firmId)
    const inv = await rpc<string>(f.manager.db, 'create_invoice_draft', {
      p_firm: f.firmId,
      p_client: ids.globexId,
      p_start: '2026-03-01',
      p_end: '2026-03-31',
      p_template: template,
      p_consultants: null,
    })
    await rpc(f.manager.db, 'set_invoice_discount', { p_invoice: inv, p_type: 'percent', p_value: 10, p_label: null })
    await rpc(f.manager.db, 'update_invoice_draft', {
      p_invoice: inv,
      p_subject: null,
      p_issue_date: '2026-04-10',
      p_due_date: '2026-05-10',
      p_tax_percent: 0,
      p_template: template,
    })
    await rpc(f.manager.db, 'issue_invoice', { p_invoice: inv })

    const byProject = await report(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'project')
    expect(row(byProject, 'Globex — no project')).toMatchObject({ revenue: '-150.00', net: '-150.00', margin: null })
    expect(row(byProject, 'Globex — Portal').margin).toBe('32.0')

    const byMonth = await report(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'month')
    expect(row(byMonth, 'Apr 2026')).toMatchObject({ revenue: '-150.00', net: '-225.00', margin: null })
    expect(row(byMonth, 'Mar 2026').margin).toBe('32.2')
  }, 60_000)
})

describe('pnl_report: sub-cent rounding', () => {
  it('rounds each row separately and the total once from the exact sum', async () => {
    // 0.33 h x 100.50 = 33.165 exact per entry, one entry in March and one in April.
    //   revenue: each month rounds 33.165 -> 33.17; rows sum to 66.34; total is round(66.330) = 66.33
    // 0.33 h x 10.01 cost = 3.3033 per entry.
    //   labour: each month 3.30; rows sum to 6.60; total is round(6.6066) = 6.61
    const f = await newFirm('PnL Rounding Firm')
    const client = await insertOne<{ id: string }>('clients', { firm_id: f.firmId, name: 'Fraction Co' })
    const project = await insertOne<{ id: string }>('projects', {
      firm_id: f.firmId,
      client_id: client.id,
      name: 'Tiny',
    })
    const lee = await insertOne<{ id: string }>('consultants', {
      firm_id: f.firmId,
      name: 'Lee',
      email: `lee-${crypto.randomUUID()}@test.local`,
      type: 'employee',
      user_id: null,
    })
    await insertOne('consultant_cost_rates', {
      firm_id: f.firmId,
      consultant_id: lee.id,
      hourly_cost: '10.01',
      effective_from: '2026-01-01',
    })
    await insertOne('project_assignments', {
      firm_id: f.firmId,
      project_id: project.id,
      consultant_id: lee.id,
      client_rate: '100.50',
      effective_from: '2026-01-01',
    })
    for (const [week, day] of [
      ['2026-03-02', '2026-03-03'],
      ['2026-04-06', '2026-04-07'],
    ]) {
      const t = await saveAndSubmit(f.manager.db, f.firmId, lee.id, week, [
        { projectId: project.id, workDate: day, hours: '0.33' },
      ])
      await rpc(f.manager.db, 'approve_timesheet', { p_timesheet: t })
    }

    const rows = await report(f.manager.db, f.firmId, '2026-03-01', '2026-04-30', 'month')
    expect(row(rows, 'Mar 2026')).toMatchObject({ revenue: '33.17', labour: '3.30', gross: '29.87' })
    expect(row(rows, 'Apr 2026')).toMatchObject({ revenue: '33.17', labour: '3.30', gross: '29.87' })
    expect(row(rows, 'Total')).toMatchObject({ revenue: '66.33', labour: '6.61', gross: '59.72', net: '59.72' })
  }, 60_000)
})

// ---------------------------------------------------------------------------
// Breakdown columns (brief B2). Same scenario as above; expected values follow
// from it (see the per-row arithmetic in the comments).
// ---------------------------------------------------------------------------

type BreakdownRow = Omit<PnlRow, 'row_kind' | 'label'> & {
  client_id: string | null
  client_label: string
  project_id: string | null
  project_label: string | null
}

function callBreakdown(
  db: SupabaseClient,
  firmId: string,
  from: string,
  to: string,
  group: string,
  splitProject: boolean,
  filters: { clients?: string[] | null; projects?: string[] | null } = {},
) {
  return db.rpc('pnl_breakdown', {
    p_firm: firmId,
    p_from: from,
    p_to: to,
    p_group: group,
    p_clients: filters.clients ?? null,
    p_projects: filters.projects ?? null,
    p_split_project: splitProject,
  })
}

async function breakdown(...args: Parameters<typeof callBreakdown>): Promise<BreakdownRow[]> {
  const { data, error } = await callBreakdown(...args)
  if (error) throw new Error(`pnl_breakdown failed: ${error.message}`)
  return data as BreakdownRow[]
}

function detail(rows: BreakdownRow[], groupKey: string, client: string, project: string | null = null): BreakdownRow {
  const r = rows.find((x) => x.group_key === groupKey && x.client_label === client && x.project_label === project)
  if (!r) {
    const have = rows.map((x) => `${x.group_key}/${x.client_label}/${x.project_label}`).join(', ')
    throw new Error(`no detail ${groupKey}/${client}/${project} in ${have}`)
  }
  return r
}

const toCents = (v: string) => Math.round(Number(v) * 100)

describe('pnl_breakdown', () => {
  let f: Firm
  let ids: PnlIds

  beforeAll(async () => {
    f = await newFirm('PnL Breakdown Firm')
    ids = await seedPnlScenario(f)
  }, 60_000)

  describe('by month, client split', () => {
    let rows: BreakdownRow[]
    let groups: PnlRow[]
    beforeAll(async () => {
      rows = await breakdown(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'month', false)
      groups = await report(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'month')
    })

    it('has one row per period x client with activity, overhead last in its period', () => {
      expect(rows.map((r) => [r.group_key, r.client_id, r.client_label, r.project_id, r.project_label])).toEqual([
        ['2026-03-01', ids.globexId, 'Globex', null, null],
        ['2026-03-01', ids.initechId, 'Initech', null, null],
        ['2026-04-01', ids.globexId, 'Globex', null, null],
        ['2026-04-01', null, 'Overhead', null, null],
        ['2026-05-01', ids.globexId, 'Globex', null, null],
      ])
      const keys = rows.map((r) => r.sort_key)
      expect([...keys].sort()).toEqual(keys)
    })

    it('March Globex: Dana 10 h x 150 = 1500, x 90 = 900, Portal travel 120', () => {
      // net 1500 - 900 - 120 = 480; margin 480 / 1500 = 32.0 %
      expect(detail(rows, '2026-03-01', 'Globex')).toMatchObject({
        revenue_hours: '1500.00',
        fees: '0.00',
        discounts: '0.00',
        revenue: '1500.00',
        labour: '900.00',
        gross: '600.00',
        direct_expenses: '120.00',
        overhead: '0.00',
        net: '480.00',
        margin: '32.0',
        invoiced: '0.00',
        collected: '0.00',
      })
    })

    it('March Initech: Lee 4 h x 200 = 800, x 120 = 480, software 60', () => {
      // net 800 - 480 - 60 = 260; margin 260 / 800 = 32.5 %
      expect(detail(rows, '2026-03-01', 'Initech')).toMatchObject({
        revenue_hours: '800.00',
        revenue: '800.00',
        labour: '480.00',
        gross: '320.00',
        direct_expenses: '60.00',
        overhead: '0.00',
        net: '260.00',
        margin: '32.5',
      })
    })

    it('the March details sum to the March group row', () => {
      const march = rows.filter((r) => r.group_key === '2026-03-01')
      const group = row(groups, 'Mar 2026')
      for (const k of MONEY) {
        const sum = march.reduce((s, r) => s + toCents(r[k]), 0)
        // Each detail row is rounded on its own, so allow half a cent per row.
        expect(Math.abs(sum - toCents(group[k]))).toBeLessThanOrEqual(march.length * 0.5)
      }
      // Every amount in this scenario is whole cents, so here the sums are exact.
      expect(march.reduce((s, r) => s + toCents(r.net), 0)).toBe(74000)
      expect(march.reduce((s, r) => s + toCents(r.revenue), 0)).toBe(230000)
    })

    it('April: Globex fees and discount, plus an Overhead row of 75.00', () => {
      // Invoice A: Setup fee 300, discount 10 % of 1800 = 180, invoiced 1800 - 180 = 1620.
      // revenue 300 - 180 = 120, net 120, margin 120 / 120 = 100.0 %
      expect(detail(rows, '2026-04-01', 'Globex')).toMatchObject({
        revenue_hours: '0.00',
        fees: '300.00',
        discounts: '180.00',
        revenue: '120.00',
        labour: '0.00',
        gross: '120.00',
        overhead: '0.00',
        net: '120.00',
        margin: '100.0',
        invoiced: '1620.00',
        collected: '0.00',
      })
      expect(detail(rows, '2026-04-01', 'Overhead')).toMatchObject({
        client_id: null,
        revenue: '0.00',
        direct_expenses: '0.00',
        overhead: '75.00',
        net: '-75.00',
        margin: null,
      })
    })

    it('May: only the Globex collection, 1000 x 1620 / 1753.65 = 923.79', () => {
      expect(detail(rows, '2026-05-01', 'Globex')).toMatchObject({
        revenue: '0.00',
        net: '0.00',
        margin: null,
        collected: '923.79',
      })
    })

    it('a client filter drops the overhead row', async () => {
      const filtered = await breakdown(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'month', false, {
        clients: [ids.globexId],
      })
      expect(filtered.map((r) => [r.group_key, r.client_label])).toEqual([
        ['2026-03-01', 'Globex'],
        ['2026-04-01', 'Globex'],
        ['2026-05-01', 'Globex'],
      ])
    })

    it('a project filter keeps only that project', async () => {
      const filtered = await breakdown(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'month', false, {
        projects: [ids.portalId],
      })
      expect(filtered.map((r) => [r.group_key, r.client_label])).toEqual([['2026-03-01', 'Globex']])
      expect(filtered[0]).toMatchObject({ revenue: '1500.00', net: '480.00' })
    })
  })

  it('by month with a project split: period x client x project', async () => {
    const rows = await breakdown(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'month', true)
    expect(rows.map((r) => [r.group_key, r.client_label, r.project_id, r.project_label])).toEqual([
      ['2026-03-01', 'Globex', ids.portalId, 'Portal'],
      ['2026-03-01', 'Initech', ids.auditId, 'Audit'],
      ['2026-03-01', 'Initech', null, 'no project'],
      ['2026-04-01', 'Globex', null, 'no project'],
      ['2026-04-01', 'Overhead', null, null],
      ['2026-05-01', 'Globex', null, 'no project'],
    ])
    // Initech/Audit: 800 - 480 = 320, margin 40.0 %; Initech/no project: the 60.00 software expense.
    expect(detail(rows, '2026-03-01', 'Initech', 'Audit')).toMatchObject({ revenue: '800.00', net: '320.00', margin: '40.0' })
    expect(detail(rows, '2026-03-01', 'Initech', 'no project')).toMatchObject({
      direct_expenses: '60.00',
      net: '-60.00',
      margin: null,
    })
  })

  it('by quarter with a client split', async () => {
    const rows = await breakdown(f.manager.db, f.firmId, '2026-01-01', '2026-06-30', 'quarter', false)
    expect(rows.map((r) => [r.group_key, r.client_label, r.revenue, r.net])).toEqual([
      ['2026-01-01', 'Globex', '1500.00', '480.00'],
      ['2026-01-01', 'Initech', '800.00', '260.00'],
      ['2026-04-01', 'Globex', '120.00', '120.00'],
      ['2026-04-01', 'Overhead', '0.00', '-75.00'],
    ])
  })

  describe('by client, project split', () => {
    let rows: BreakdownRow[]
    let byProject: PnlRow[]
    beforeAll(async () => {
      rows = await breakdown(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'client', false)
      byProject = await report(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'project')
    })

    it('has one row per client x project, no overhead', () => {
      expect(rows.map((r) => [r.group_key, r.client_label, r.project_label])).toEqual([
        [ids.globexId, 'Globex', 'Portal'],
        [ids.globexId, 'Globex', 'no project'],
        [ids.initechId, 'Initech', 'Audit'],
        [ids.initechId, 'Initech', 'no project'],
      ])
    })

    it('the rows equal the project-grouping figures', () => {
      const pick = (r: Record<string, unknown>) => Object.fromEntries([...MONEY, 'margin'].map((k) => [k, r[k]]))
      expect(pick(detail(rows, ids.globexId, 'Globex', 'Portal'))).toEqual(pick(row(byProject, 'Globex — Portal')))
      expect(pick(detail(rows, ids.globexId, 'Globex', 'no project'))).toEqual(pick(row(byProject, 'Globex — no project')))
      expect(pick(detail(rows, ids.initechId, 'Initech', 'Audit'))).toEqual(pick(row(byProject, 'Initech — Audit')))
      expect(pick(detail(rows, ids.initechId, 'Initech', 'no project'))).toEqual(pick(row(byProject, 'Initech — no project')))
      expect(detail(rows, ids.globexId, 'Globex', 'Portal')).toMatchObject({ revenue: '1500.00', net: '480.00' })
      expect(detail(rows, ids.globexId, 'Globex', 'no project')).toMatchObject({
        revenue: '120.00',
        net: '120.00',
        invoiced: '1620.00',
        collected: '923.79',
      })
    })
  })

  describe('errors and access', () => {
    it("rejects 'project' and unknown groupings", async () => {
      for (const g of ['project', 'week']) {
        const { error } = await callBreakdown(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', g, false)
        expect(errorText(error)).toContain('PNL_GROUP_INVALID')
      }
    })

    it('rejects a reversed range', async () => {
      const { error } = await callBreakdown(f.manager.db, f.firmId, '2026-05-01', '2026-04-30', 'month', false)
      expect(errorText(error)).toContain('PNL_RANGE_INVALID')
    })

    it('admins may run it', async () => {
      const rows = await breakdown(f.admin.db, f.firmId, '2026-03-01', '2026-05-31', 'month', false)
      expect(rows).toHaveLength(5)
    })

    it('consultants get 42501', async () => {
      const { error } = await callBreakdown(f.consultant.db, f.firmId, '2026-03-01', '2026-05-31', 'month', false)
      expect(error?.code).toBe('42501')
    })

    it("another firm's manager gets 42501", async () => {
      const other = await newFirm('Other PnL Breakdown Firm')
      const { error } = await callBreakdown(other.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'client', false)
      expect(error?.code).toBe('42501')
    })
  })

  it('pnl_report returns the client and project names under project grouping', async () => {
    const { data, error } = await call(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'project')
    if (error) throw new Error(error.message)
    const rows = data as (PnlRow & { client_label: string | null; project_label: string | null })[]
    expect(rows.map((r) => [r.label, r.client_label, r.project_label])).toEqual([
      ['Globex — Portal', 'Globex', 'Portal'],
      ['Globex — no project', 'Globex', 'no project'],
      ['Initech — Audit', 'Initech', 'Audit'],
      ['Initech — no project', 'Initech', 'no project'],
      ['Unallocated overhead', null, null],
      ['Total', null, null],
    ])
    const byMonth = await call(f.manager.db, f.firmId, '2026-03-01', '2026-05-31', 'month')
    const monthRows = byMonth.data as { client_label: string | null; project_label: string | null }[]
    expect(monthRows).toHaveLength(4)
    expect(monthRows.every((r) => r.client_label === null && r.project_label === null)).toBe(true)
  })

  describe('getPnl with a split', () => {
    const base = { from: '2026-03-01', to: '2026-05-31', clientIds: null, projectIds: null }

    it('interleaves detail rows and subtotals by month', async () => {
      const res = await getPnl(f.manager.db, f.firmId, { ...base, group: 'month', split: { client: true, project: false } })
      if (!res.ok) throw new Error(res.error)
      expect(res.data.map((r) => [r.kind, r.label, r.clientLabel, r.projectLabel])).toEqual([
        ['detail', 'Mar 2026', 'Globex', null],
        ['detail', 'Mar 2026', 'Initech', null],
        ['subtotal', 'Mar 2026 subtotal', null, null],
        ['detail', 'Apr 2026', 'Globex', null],
        ['detail', 'Apr 2026', 'Overhead', null],
        ['subtotal', 'Apr 2026 subtotal', null, null],
        ['detail', 'May 2026', 'Globex', null],
        ['subtotal', 'May 2026 subtotal', null, null],
        ['total', 'Total', null, null],
      ])
      expect(res.data[0]).toMatchObject({ revenue: '1500.00', net: '480.00', margin: '32.0' })
      expect(res.data[2]).toMatchObject({ revenue: '2300.00', net: '740.00', margin: '32.2' })
      expect(res.data.at(-1)).toMatchObject({ net: '785.00' })
      expect(new Set(res.data.map((r) => `${r.kind}:${r.key}`)).size).toBe(res.data.length)
    })

    it('interleaves project rows and subtotals by client, then overhead and total', async () => {
      const res = await getPnl(f.manager.db, f.firmId, { ...base, group: 'client', split: { client: false, project: true } })
      if (!res.ok) throw new Error(res.error)
      expect(res.data.map((r) => [r.kind, r.label, r.clientLabel, r.projectLabel, r.net])).toEqual([
        ['detail', 'Globex', 'Globex', 'Portal', '480.00'],
        ['detail', 'Globex', 'Globex', 'no project', '120.00'],
        ['subtotal', 'Globex subtotal', null, null, '600.00'],
        ['detail', 'Initech', 'Initech', 'Audit', '320.00'],
        ['detail', 'Initech', 'Initech', 'no project', '-60.00'],
        ['subtotal', 'Initech subtotal', null, null, '260.00'],
        ['overhead', 'Unallocated overhead', null, null, '-75.00'],
        ['total', 'Total', null, null, '785.00'],
      ])
    })

    it('fills client and project labels under project grouping; null otherwise', async () => {
      const res = await getPnl(f.manager.db, f.firmId, { ...base, group: 'project', split: { client: false, project: false } })
      if (!res.ok) throw new Error(res.error)
      expect(res.data.map((r) => [r.kind, r.clientLabel, r.projectLabel])).toEqual([
        ['group', 'Globex', 'Portal'],
        ['group', 'Globex', 'no project'],
        ['group', 'Initech', 'Audit'],
        ['group', 'Initech', 'no project'],
        ['overhead', null, null],
        ['total', null, null],
      ])
      const month = await getPnl(f.manager.db, f.firmId, { ...base, group: 'month', split: { client: false, project: false } })
      if (!month.ok) throw new Error(month.error)
      expect(month.data.map((r) => r.kind)).toEqual(['group', 'group', 'group', 'total'])
      expect(month.data.every((r) => r.clientLabel === null && r.projectLabel === null)).toBe(true)
    })
  })
})
