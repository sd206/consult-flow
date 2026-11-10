import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { getDashboardSummary } from '@/modules/firms/dashboard'
import { todayIso } from '@/lib/domain/dates'
import { addDays } from '@/lib/domain/weeks'
import { adminDb, newFirm } from './helpers'
import { issueManualInvoice } from './invoice-fixtures'
import { PAST_WEEK, seedTimesheetFixture } from './timesheet-fixtures'

/** The same client, with rpc() replaced. */
function spyRpc(db: SupabaseClient, rpc: (...args: unknown[]) => unknown): SupabaseClient {
  return new Proxy(db, {
    get: (target, key, receiver) => (key === 'rpc' ? rpc : Reflect.get(target, key, receiver)),
  })
}

describe('getDashboardSummary', () => {
  it('counts active consultants, clients, projects and setup progress for a manager', async () => {
    const f = await newFirm()
    const a = adminDb()
    const first = await getDashboardSummary(f.manager.db, f.firmId, 'manager')
    expect(first).toEqual({
      ok: true,
      data: { consultants: 0, clients: 0, projects: 0, assignments: 0, hasLogo: false, awaitingApproval: 0, outstanding: '0.00', overdue: '0.00', overdueCount: 0 },
    })

    const { data: c1 } = await a.from('clients').insert({ firm_id: f.firmId, name: 'Active Co' }).select('id').single()
    await a.from('clients').insert({ firm_id: f.firmId, name: 'Gone Co', active: false })
    const { data: p } = await a
      .from('projects')
      .insert({ firm_id: f.firmId, client_id: c1!.id, name: 'P1' })
      .select('id')
      .single()
    await a.from('projects').insert({ firm_id: f.firmId, client_id: c1!.id, name: 'P2', status: 'closed' })
    const { data: k } = await a
      .from('consultants')
      .insert({ firm_id: f.firmId, name: 'K', email: `k-${crypto.randomUUID()}@test.local`, type: 'employee' })
      .select('id')
      .single()
    await a
      .from('consultants')
      .insert({ firm_id: f.firmId, name: 'Old', email: `o-${crypto.randomUUID()}@test.local`, type: 'employee', active: false })
    await a.from('project_assignments').insert({
      firm_id: f.firmId,
      project_id: p!.id,
      consultant_id: k!.id,
      client_rate: 100,
      effective_from: '2026-01-01',
    })
    await a.from('firms').update({ logo_path: `firms/${f.firmId}/logo/x.png` }).eq('id', f.firmId)

    const res = await getDashboardSummary(f.manager.db, f.firmId, 'manager')
    expect(res).toEqual({
      ok: true,
      data: { consultants: 1, clients: 1, projects: 1, assignments: 1, hasLogo: true, awaitingApproval: 0, outstanding: '0.00', overdue: '0.00', overdueCount: 0 },
    })
  })

  it('a consultant gets zero counts (RLS hides firm data; the firm row itself is member-readable)', async () => {
    const f = await newFirm()
    const a = adminDb()
    const { data: c1 } = await a.from('clients').insert({ firm_id: f.firmId, name: 'Co' }).select('id').single()
    await a.from('projects').insert({ firm_id: f.firmId, client_id: c1!.id, name: 'P' })
    await a.from('firms').update({ logo_path: `firms/${f.firmId}/logo/x.png` }).eq('id', f.firmId)
    const rpcCalls: unknown[] = []
    const db = spyRpc(f.consultant.db, (...args) => {
      rpcCalls.push(args)
      return f.consultant.db.rpc(...(args as Parameters<SupabaseClient['rpc']>))
    })
    const res = await getDashboardSummary(db, f.firmId, 'consultant')
    expect(res).toMatchObject({
      ok: true,
      data: { consultants: 0, clients: 0, projects: 0, assignments: 0, outstanding: '0.00', overdue: '0.00', overdueCount: 0 },
    })
    // Consultants never ask for the outstanding summary at all.
    expect(rpcCalls).toEqual([])
  })

  it('a manager sees an outstanding-summary failure as an error, not zeros', async () => {
    const f = await newFirm()
    const db = spyRpc(f.manager.db, async () => ({ data: null, error: { code: '42501', message: 'permission denied' } }))
    const res = await getDashboardSummary(db, f.firmId, 'manager')
    expect(res).toEqual({ ok: false, error: "You don't have permission to do that." })
  })

  it('counts submitted timesheets as awaiting approval', async () => {
    const f = await newFirm()
    const s = await seedTimesheetFixture(f)
    const save = await f.consultant.db.rpc('save_timesheet_week', {
      p_firm: f.firmId,
      p_consultant: s.consultantId,
      p_week_start: PAST_WEEK,
      p_entries: [{ projectId: s.projectId, workDate: PAST_WEEK, hours: '8', note: null }],
    })
    expect(save.error).toBeNull()
    const before = await getDashboardSummary(f.manager.db, f.firmId, 'manager')
    expect(before).toMatchObject({ ok: true, data: { awaitingApproval: 0 } })
    const sub = await f.consultant.db.rpc('submit_timesheet', { p_timesheet: save.data as string })
    expect(sub.error).toBeNull()
    const after = await getDashboardSummary(f.manager.db, f.firmId, 'manager')
    expect(after).toMatchObject({ ok: true, data: { awaitingApproval: 1 } })
  })

  it('includes outstanding and overdue totals as strings', async () => {
    const f = await newFirm()
    const a = await issueManualInvoice(f, '300.00')
    const b = await issueManualInvoice(f, '200.50')
    const due = addDays(todayIso(), -10)
    await adminDb().from('invoices').update({ issue_date: due, due_date: due }).eq('id', a.invoiceId)
    const res = await getDashboardSummary(f.manager.db, f.firmId, 'manager')
    expect(res).toMatchObject({ ok: true, data: { outstanding: '500.50', overdue: '300.00', overdueCount: 1 } })
    void b
  })
})
