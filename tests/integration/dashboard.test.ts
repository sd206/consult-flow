import { describe, expect, it } from 'vitest'
import { getDashboardSummary } from '@/modules/firms/dashboard'
import { adminDb, newFirm } from './helpers'

describe('getDashboardSummary', () => {
  it('counts active consultants, clients, projects and setup progress for a manager', async () => {
    const f = await newFirm()
    const a = adminDb()
    const first = await getDashboardSummary(f.manager.db, f.firmId)
    expect(first).toEqual({
      ok: true,
      data: { consultants: 0, clients: 0, projects: 0, assignments: 0, hasLogo: false },
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
      data: { consultants: 1, clients: 1, projects: 1, assignments: 1, hasLogo: true },
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
})
