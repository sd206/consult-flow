import { describe, expect, it } from 'vitest'
import { adminDb, newFirm } from './helpers'

type Firm = Awaited<ReturnType<typeof newFirm>>

async function mkVendor(f: Firm, name = 'Acme Staffing') {
  const { data, error } = await f.manager.db
    .from('vendors')
    .insert({ firm_id: f.firmId, name })
    .select()
    .single()
  expect(error).toBeNull()
  return data!
}

async function mkVendorConsultant(f: Firm, vendorId: string) {
  return f.manager.db
    .from('consultants')
    .insert({
      firm_id: f.firmId,
      name: 'Vee Vendor',
      email: `vee-${crypto.randomUUID()}@test.local`,
      type: 'vendor',
      vendor_id: vendorId,
    })
    .select()
    .single()
}

const text = (e: { message?: string; details?: string } | null) => `${e?.message} ${e?.details}`

describe('people schema', () => {
  it('manager creates vendor, vendor consultant and a cost rate', async () => {
    const f = await newFirm()
    const vendor = await mkVendor(f)
    const { data: c, error: cErr } = await mkVendorConsultant(f, vendor.id)
    expect(cErr).toBeNull()
    expect(c!.active).toBe(true)
    const { data: rate, error: rErr } = await f.manager.db
      .from('consultant_cost_rates')
      .insert({
        firm_id: f.firmId,
        consultant_id: c!.id,
        hourly_cost: 150.0,
        effective_from: '2026-01-01',
      })
      .select()
      .single()
    expect(rErr).toBeNull()
    expect(Number(rate!.hourly_cost)).toBe(150)
  })

  it('vendor-type consultant requires vendor_id', async () => {
    const f = await newFirm()
    const { error } = await f.manager.db.from('consultants').insert({
      firm_id: f.firmId,
      name: 'No Vendor',
      email: `nv-${crypto.randomUUID()}@test.local`,
      type: 'vendor',
    })
    expect(error?.code).toBe('23514')
    expect(text(error)).toContain('consultants_vendor_required_chk')
  })

  it('non-vendor consultant must not carry a vendor_id', async () => {
    const f = await newFirm()
    const vendor = await mkVendor(f)
    const { error } = await f.manager.db.from('consultants').insert({
      firm_id: f.firmId,
      name: 'Indy',
      email: `indy-${crypto.randomUUID()}@test.local`,
      type: 'independent',
      vendor_id: vendor.id,
    })
    expect(error?.code).toBe('23514')
    expect(text(error)).toContain('consultants_vendor_required_chk')
  })

  it('consultant cannot point at another firm vendor', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const bVendor = await mkVendor(b)
    const { error } = await mkVendorConsultant(a, bVendor.id)
    expect(error?.code).toBe('23503')
    expect(text(error)).toContain('consultants_vendor_fk')
    const { data } = await adminDb().from('consultants').select('id').eq('firm_id', a.firmId)
    expect(data).toHaveLength(0)
  })

  it('cannot delete a vendor that has consultants', async () => {
    const f = await newFirm()
    const vendor = await mkVendor(f)
    const { error: cErr } = await mkVendorConsultant(f, vendor.id)
    expect(cErr).toBeNull()
    const { error } = await f.manager.db.from('vendors').delete().eq('id', vendor.id)
    expect(error?.code).toBe('23503')
    expect(text(error)).toContain('consultants_vendor_fk')
    const { data } = await adminDb().from('vendors').select('id').eq('id', vendor.id)
    expect(data).toHaveLength(1)
  })

  it('rejects duplicate cost rate for the same effective_from', async () => {
    const f = await newFirm()
    const vendor = await mkVendor(f)
    const { data: c } = await mkVendorConsultant(f, vendor.id)
    const row = {
      firm_id: f.firmId,
      consultant_id: c!.id,
      hourly_cost: 100,
      effective_from: '2026-01-01',
    }
    const { error: e1 } = await f.manager.db.from('consultant_cost_rates').insert(row)
    expect(e1).toBeNull()
    const { error } = await f.manager.db.from('consultant_cost_rates').insert(row)
    expect(error?.code).toBe('23505')
    expect(text(error)).toContain('consultant_cost_rates_consultant_from_key')
    const { data } = await adminDb()
      .from('consultant_cost_rates')
      .select('id')
      .eq('consultant_id', c!.id)
    expect(data).toHaveLength(1)
  })

  it('rejects negative hourly_cost', async () => {
    const f = await newFirm()
    const vendor = await mkVendor(f)
    const { data: c } = await mkVendorConsultant(f, vendor.id)
    const { error } = await f.manager.db.from('consultant_cost_rates').insert({
      firm_id: f.firmId,
      consultant_id: c!.id,
      hourly_cost: -1,
      effective_from: '2026-01-01',
    })
    expect(error?.code).toBe('23514')
  })

  it('consultant user sees only own consultants row, no vendors or cost rates', async () => {
    const f = await newFirm()
    const vendor = await mkVendor(f)
    const { data: vc } = await mkVendorConsultant(f, vendor.id)
    const { data: own, error: ownErr } = await f.manager.db
      .from('consultants')
      .insert({
        firm_id: f.firmId,
        name: 'Me',
        email: `me-${crypto.randomUUID()}@test.local`,
        type: 'employee',
        user_id: f.consultant.id,
      })
      .select()
      .single()
    expect(ownErr).toBeNull()
    const { error: rateErr } = await f.manager.db.from('consultant_cost_rates').insert({
      firm_id: f.firmId,
      consultant_id: own!.id,
      hourly_cost: 50,
      effective_from: '2026-01-01',
    })
    expect(rateErr).toBeNull()

    const { data: cs, error } = await f.consultant.db.from('consultants').select('id')
    expect(error).toBeNull()
    expect(cs).toHaveLength(1)
    expect(cs![0].id).toBe(own!.id)
    expect(cs![0].id).not.toBe(vc!.id)

    const { data: vs } = await f.consultant.db.from('vendors').select('id')
    expect(vs).toHaveLength(0)
    const { data: rs } = await f.consultant.db.from('consultant_cost_rates').select('id')
    expect(rs).toHaveLength(0)

    const { error: insErr } = await f.consultant.db
      .from('vendors')
      .insert({ firm_id: f.firmId, name: 'Sneaky' })
    expect(insErr).not.toBeNull()
    const { data: seen } = await adminDb().from('vendors').select('id').eq('name', 'Sneaky')
    expect(seen).toHaveLength(0)
  })

  it('another firm manager sees none of firm A rows', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const vendor = await mkVendor(a)
    const { data: c } = await mkVendorConsultant(a, vendor.id)
    const { error: rErr } = await a.manager.db.from('consultant_cost_rates').insert({
      firm_id: a.firmId,
      consultant_id: c!.id,
      hourly_cost: 10,
      effective_from: '2026-01-01',
    })
    expect(rErr).toBeNull()
    for (const t of ['vendors', 'consultants', 'consultant_cost_rates'] as const) {
      const { data: all } = await adminDb().from(t).select('id').eq('firm_id', a.firmId)
      expect(all!.length).toBeGreaterThan(0)
      const { data, error } = await b.manager.db.from(t).select('id')
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    }
  })

  it('cost-rate insert writes an audit_log row', async () => {
    const f = await newFirm()
    const vendor = await mkVendor(f)
    const { data: c } = await mkVendorConsultant(f, vendor.id)
    const { data: rate } = await f.manager.db
      .from('consultant_cost_rates')
      .insert({
        firm_id: f.firmId,
        consultant_id: c!.id,
        hourly_cost: 150,
        effective_from: '2026-01-01',
      })
      .select()
      .single()
    const { data } = await adminDb()
      .from('audit_log')
      .select('*')
      .eq('firm_id', f.firmId)
      .eq('entity_type', 'consultant_cost_rates')
      .eq('action', 'insert')
    expect(data).toHaveLength(1)
    expect(data![0].entity_id).toBe(rate!.id)
    expect(data![0].actor_id).toBe(f.manager.id)
  })
  async function mkEmployee(f: Firm, userId?: string) {
    return f.manager.db
      .from('consultants')
      .insert({
        firm_id: f.firmId,
        name: 'Emp',
        email: `emp-${crypto.randomUUID()}@test.local`,
        type: 'employee',
        ...(userId ? { user_id: userId } : {}),
      })
      .select()
      .single()
  }

  it('rejects linking user_id to a non-member of the firm', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const { data: c } = await mkEmployee(a)
    const { error } = await a.manager.db
      .from('consultants')
      .update({ user_id: b.consultant.id })
      .eq('id', c!.id)
    expect(error?.code).toBe('23503')
    expect(text(error)).toContain('consultants_member_fk')
    const { data: row } = await adminDb().from('consultants').select('user_id').eq('id', c!.id).single()
    expect(row!.user_id).toBeNull()
    const { error: insErr } = await mkEmployee(a, b.consultant.id)
    expect(insErr?.code).toBe('23503')
    expect(text(insErr)).toContain('consultants_member_fk')
  })

  it('member link works; removing the member clears the link and access', async () => {
    const f = await newFirm()
    const { data: c, error } = await mkEmployee(f, f.consultant.id)
    expect(error).toBeNull()
    const { data: before } = await f.consultant.db.from('consultants').select('id')
    expect(before).toHaveLength(1)
    const { error: delErr } = await adminDb()
      .from('firm_members')
      .delete()
      .eq('firm_id', f.firmId)
      .eq('user_id', f.consultant.id)
    expect(delErr).toBeNull()
    const { data: row } = await adminDb().from('consultants').select('user_id').eq('id', c!.id).single()
    expect(row!.user_id).toBeNull()
    const { data: after } = await f.consultant.db.from('consultants').select('id')
    expect(after).toHaveLength(0)
  })

  it('rejects linking one user to two consultants in a firm', async () => {
    const f = await newFirm()
    const { error: e1 } = await mkEmployee(f, f.consultant.id)
    expect(e1).toBeNull()
    const { error } = await mkEmployee(f, f.consultant.id)
    expect(error?.code).toBe('23505')
    expect(text(error)).toContain('consultants_firm_user_key')
    const { data } = await adminDb().from('consultants').select('id').eq('firm_id', f.firmId)
    expect(data).toHaveLength(1)
  })

  it('consultant cannot update or delete their own consultants row', async () => {
    const f = await newFirm()
    const { data: c } = await mkEmployee(f, f.consultant.id)
    const { data: upd, error: uErr } = await f.consultant.db
      .from('consultants')
      .update({ name: 'Hacked', active: false })
      .eq('id', c!.id)
      .select()
    expect(uErr).toBeNull()
    expect(upd).toHaveLength(0)
    const { data: del, error: dErr } = await f.consultant.db
      .from('consultants')
      .delete()
      .eq('id', c!.id)
      .select()
    expect(dErr).toBeNull()
    expect(del).toHaveLength(0)
    const { data: row } = await adminDb().from('consultants').select('name, active').eq('id', c!.id).single()
    expect(row).toEqual({ name: 'Emp', active: true })
  })
})
