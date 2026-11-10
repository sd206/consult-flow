import { describe, expect, it } from 'vitest'
import { getDashboardSummary } from '@/modules/firms/dashboard'
import { todayIso } from '@/lib/domain/dates'
import { addDays } from '@/lib/domain/weeks'
import { adminDb, newFirm } from './helpers'
import { issueManualInvoice } from './invoice-fixtures'
import { PAST_WEEK, seedTimesheetFixture } from './timesheet-fixtures'

describe('getDashboardSummary', () => {
  it('counts active consultants, clients, projects and setup progress for a manager', async () => {
    const f = await newFirm()
    const a = adminDb()
    const first = await getDashboardSummary(f.manager.db, f.firmId)
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

    const res = await getDashboardSummary(f.manager.db, f.firmId)
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
    const res = await getDashboardSummary(f.consultant.db, f.firmId)
    expect(res).toMatchObject({
      ok: true,
      data: { consultants: 0, clients: 0, projects: 0, assignments: 0 },
    })
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
    const before = await getDashboardSummary(f.manager.db, f.firmId)
    expect(before).toMatchObject({ ok: true, data: { awaitingApproval: 0 } })
    const sub = await f.consultant.db.rpc('submit_timesheet', { p_timesheet: save.data as string })
    expect(sub.error).toBeNull()
    const after = await getDashboardSummary(f.manager.db, f.firmId)
    expect(after).toMatchObject({ ok: true, data: { awaitingApproval: 1 } })
  })

  it('includes outstanding and overdue totals as strings', async () => {
    const f = await newFirm()
    const a = await issueManualInvoice(f, '300.00')
    const b = await issueManualInvoice(f, '200.50')
    const due = addDays(todayIso(), -10)
    await adminDb().from('invoices').update({ issue_date: due, due_date: due }).eq('id', a.invoiceId)
    const res = await getDashboardSummary(f.manager.db, f.firmId)
    expect(res).toMatchObject({ ok: true, data: { outstanding: '500.50', overdue: '300.00', overdueCount: 1 } })
    void b
  })
})
