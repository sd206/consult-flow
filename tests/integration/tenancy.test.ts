import { describe, expect, it } from 'vitest'
import { adminDb, anonDb, newFirm, newUser, signIn } from './helpers'

describe('core tenancy RLS', () => {
  it('member reads own firm, not another', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const { data } = await a.admin.db.from('firms').select('id')
    expect(data).toHaveLength(1)
    expect(data?.[0].id).toBe(a.firmId)
    const { data: other } = await a.admin.db.from('firms').select('id').eq('id', b.firmId)
    expect(other).toHaveLength(0)
  })

  it('consultant cannot update firm settings', async () => {
    const a = await newFirm('Orig')
    const { data, error } = await a.consultant.db
      .from('firms')
      .update({ name: 'Hacked' })
      .eq('id', a.firmId)
      .select()
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
    const { data: row } = await adminDb().from('firms').select('name').eq('id', a.firmId).single()
    expect(row?.name).toBe('Orig')
  })

  it('admin updates firm name', async () => {
    const a = await newFirm('Orig')
    const { data, error } = await a.admin.db
      .from('firms')
      .update({ name: 'Renamed' })
      .eq('id', a.firmId)
      .select()
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0].name).toBe('Renamed')
  })

  it('firm defaults match spec', async () => {
    const a = await newFirm()
    const { data } = await adminDb().from('firms').select('*').eq('id', a.firmId).single()
    expect(data).toMatchObject({
      invoice_number_pattern: 'INV-{YYYY}-{SEQ:4}',
      invoice_next_seq: 1,
      currency: 'USD',
      default_tax_percent: 0,
      default_payment_terms_days: 30,
    })
  })

  it('nobody inserts firm_members from the client', async () => {
    const a = await newFirm()
    const u = await newUser('outsider')
    const { error } = await a.admin.db
      .from('firm_members')
      .insert({ firm_id: a.firmId, user_id: u.id, role: 'admin' })
    expect(error).not.toBeNull()
  })

  it('admin changes a role', async () => {
    const a = await newFirm()
    const { data, error } = await a.admin.db
      .from('firm_members')
      .update({ role: 'consultant' })
      .eq('firm_id', a.firmId)
      .eq('user_id', a.manager.id)
      .select()
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('last admin cannot be demoted', async () => {
    const a = await newFirm()
    const { error } = await a.admin.db
      .from('firm_members')
      .update({ role: 'manager' })
      .eq('firm_id', a.firmId)
      .eq('user_id', a.admin.id)
    expect(error?.message).toContain('LAST_ADMIN')
    await adminDb()
      .from('firm_members')
      .update({ role: 'admin' })
      .eq('firm_id', a.firmId)
      .eq('user_id', a.manager.id)
    const { error: e2 } = await a.admin.db
      .from('firm_members')
      .update({ role: 'manager' })
      .eq('firm_id', a.firmId)
      .eq('user_id', a.admin.id)
    expect(e2).toBeNull()
  })

  it('admin cannot delete self', async () => {
    const a = await newFirm()
    const { data } = await a.admin.db
      .from('firm_members')
      .delete()
      .eq('firm_id', a.firmId)
      .eq('user_id', a.admin.id)
      .select()
    expect(data).toHaveLength(0)
  })

  it('profile created on signup', async () => {
    const u = await newUser('prof')
    const { data } = await adminDb().from('profiles').select('*').eq('user_id', u.id).single()
    expect(data?.email).toBe(u.email)
    expect(data?.is_platform_owner).toBe(false)
  })

  it('cannot escalate via profile or touch a foreign firm', async () => {
    const a = await newFirm()
    const b = await newFirm()
    const { error } = await a.admin.db
      .from('profiles')
      .update({ is_platform_owner: true })
      .eq('user_id', a.admin.id)
    expect(error).not.toBeNull()
    const { data } = await a.admin.db
      .from('firm_members')
      .update({ role: 'consultant' })
      .eq('firm_id', b.firmId)
      .select()
    expect(data).toHaveLength(0)
    const { data: del } = await a.admin.db
      .from('firm_members')
      .delete()
      .eq('firm_id', b.firmId)
      .select()
    expect(del).toHaveLength(0)
  })

  it('has_role works with a text array from TS', async () => {
    const a = await newFirm()
    const { data } = await a.admin.db.rpc('has_role', { p_firm: a.firmId, p_roles: ['admin'] })
    expect(data).toBe(true)
    const { data: no } = await a.consultant.db.rpc('has_role', {
      p_firm: a.firmId,
      p_roles: ['admin'],
    })
    expect(no).toBe(false)
  })

  it('platform owner sees firm list only', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const owner = await signIn('owner@local.test', 'owner-password-123')
    // Filter server-side: the full list is ordered oldest first and capped at max_rows.
    const { data, error } = await owner.db.rpc('platform_list_firms').in('id', [a.firmId, b.firmId])
    expect(error).toBeNull()
    const ids = (data as { id: string }[]).map((r) => r.id)
    expect(ids).toHaveLength(2)
    expect(ids).toContain(a.firmId)
    expect(ids).toContain(b.firmId)
    const { data: firms } = await owner.db.from('firms').select('id')
    expect(firms).toHaveLength(0)
    const { data: adminList } = await a.admin.db.rpc('platform_list_firms')
    expect(adminList).toHaveLength(0)
  })

  it('anon reads nothing', async () => {
    await newFirm()
    const db = anonDb()
    for (const t of ['firms', 'firm_members', 'profiles']) {
      const { data } = await db.from(t).select('*')
      expect(data ?? []).toHaveLength(0)
    }
  })
})
