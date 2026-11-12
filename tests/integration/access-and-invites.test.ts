import { beforeAll, describe, expect, it } from 'vitest'
import { adminDb, newFirm } from './helpers'

type Firm = Awaited<ReturnType<typeof newFirm>>
type Login = { user_id: string; invite_pending: boolean; signed_in: boolean }

describe('firm_member_logins', () => {
  it('tells admins who accepted their invite and who has signed in', async () => {
    const f = await newFirm('Logins Firm')
    const email = `pending-${crypto.randomUUID()}@test.local`
    const { data: invited, error } = await adminDb().auth.admin.inviteUserByEmail(email)
    expect(error).toBeNull()
    await adminDb().from('firm_members').insert({ firm_id: f.firmId, user_id: invited.user!.id, role: 'manager' })

    const r = await f.admin.db.rpc('firm_member_logins', { p_firm: f.firmId })
    expect(r.error).toBeNull()
    const rows = r.data as Login[]
    expect(rows.find((x) => x.user_id === invited.user!.id)).toMatchObject({ invite_pending: true, signed_in: false })
    expect(rows.find((x) => x.user_id === f.manager.id)).toMatchObject({ invite_pending: false, signed_in: true })
    expect(rows).toHaveLength(4)
  })

  it('refuses managers and other firms', async () => {
    const f = await newFirm('Logins Refuse Firm')
    const other = await newFirm('Logins Other Firm')
    for (const db of [f.manager.db, f.consultant.db, other.admin.db]) {
      const r = await db.rpc('firm_member_logins', { p_firm: f.firmId })
      expect(r.error?.code).toBe('42501')
    }
  })
})

describe('consultants, cost rates and vendors are admin-only to change', () => {
  let f: Firm
  let consultantId: string
  let vendorId: string

  beforeAll(async () => {
    f = await newFirm('Admin Only People Firm')
    const v = await f.admin.db.from('vendors').insert({ firm_id: f.firmId, name: 'Acme Staffing' }).select('id').single()
    expect(v.error).toBeNull()
    vendorId = v.data!.id
    const c = await f.admin.db
      .from('consultants')
      .insert({ firm_id: f.firmId, name: 'Dana', email: `dana-${crypto.randomUUID()}@test.local`, type: 'independent' })
      .select('id')
      .single()
    expect(c.error).toBeNull()
    consultantId = c.data!.id
    const rate = await f.admin.db
      .from('consultant_cost_rates')
      .insert({ firm_id: f.firmId, consultant_id: consultantId, hourly_cost: '90.00', effective_from: '2026-01-01' })
    expect(rate.error).toBeNull()
  })

  it('managers can still read them', async () => {
    expect((await f.manager.db.from('consultants').select('id').eq('id', consultantId)).data).toHaveLength(1)
    expect((await f.manager.db.from('vendors').select('id').eq('id', vendorId)).data).toHaveLength(1)
    expect((await f.manager.db.from('consultant_cost_rates').select('id').eq('consultant_id', consultantId)).data).toHaveLength(1)
  })

  it('managers cannot add, change or delete them', async () => {
    const m = f.manager.db
    expect((await m.from('consultants').insert({ firm_id: f.firmId, name: 'X', email: `x-${crypto.randomUUID()}@test.local`, type: 'employee' })).error).not.toBeNull()
    expect((await m.from('consultants').update({ name: 'Renamed' }).eq('id', consultantId).select('id')).data ?? []).toHaveLength(0)
    expect((await m.from('consultants').delete().eq('id', consultantId).select('id')).data ?? []).toHaveLength(0)
    expect((await m.from('vendors').insert({ firm_id: f.firmId, name: 'Other Co' })).error).not.toBeNull()
    expect((await m.from('vendors').update({ name: 'Renamed' }).eq('id', vendorId).select('id')).data ?? []).toHaveLength(0)
    expect(
      (await m.from('consultant_cost_rates').insert({ firm_id: f.firmId, consultant_id: consultantId, hourly_cost: '1.00', effective_from: '2026-02-01' })).error,
    ).not.toBeNull()
    expect((await m.from('consultant_cost_rates').delete().eq('consultant_id', consultantId).select('id')).data ?? []).toHaveLength(0)
    const { data } = await adminDb().from('consultants').select('name').eq('id', consultantId).single()
    expect(data!.name).toBe('Dana')
  })
})
