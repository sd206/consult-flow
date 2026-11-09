import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { todayIso } from '@/lib/domain/dates'
import {
  addCostRate,
  createConsultant,
  deleteCostRate,
  getConsultant,
  listConsultants,
  setConsultantActive,
  updateConsultant,
} from '@/modules/consultants/data'
import { createVendor, deleteVendor, listVendors, updateVendor } from '@/modules/vendors/data'
import { adminDb, newFirm } from './helpers'

const DENIED = "You don't have permission to do that."
const uniq = () => crypto.randomUUID().slice(0, 8)
const email = () => `c-${crypto.randomUUID()}@test.local`

async function consultantCount(firmId: string, mail?: string) {
  let q = adminDb().from('consultants').select('id', { count: 'exact', head: true }).eq('firm_id', firmId)
  if (mail) q = q.ilike('email', mail)
  const { count, error } = await q
  expect(error).toBeNull()
  return count ?? 0
}

describe('vendors', () => {
  it('creates, lists, updates and deletes; duplicate name is rejected', async () => {
    const f = await newFirm()
    const name = `Acme ${uniq()}`
    const v = await createVendor(f.admin.db, f.firmId, { name, email: 'a@b.co' })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const dup = await createVendor(f.manager.db, f.firmId, { name: name.toUpperCase() })
    expect(dup).toEqual({ ok: false, error: 'That name is already in use.' })

    const upd = await updateVendor(f.manager.db, f.firmId, v.data.id, { name, phone: '555' })
    expect(upd.ok).toBe(true)
    const list = await listVendors(f.manager.db, f.firmId)
    expect(list.ok && list.data.map((x) => x.name)).toEqual([name])

    expect((await deleteVendor(f.admin.db, f.firmId, v.data.id)).ok).toBe(true)
    const after = await listVendors(f.admin.db, f.firmId)
    expect(after.ok && after.data).toEqual([])
  })

  it('a consultant-role member cannot create a vendor', async () => {
    const f = await newFirm()
    const res = await createVendor(f.consultant.db, f.firmId, { name: 'Nope' })
    expect(res.ok).toBe(false)
    const { count } = await adminDb()
      .from('vendors')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', f.firmId)
    expect(count).toBe(0)
  })

  it('deleteVendor with a linked consultant fails and keeps the vendor', async () => {
    const f = await newFirm()
    const v = await createVendor(f.admin.db, f.firmId, { name: `V ${uniq()}` })
    if (!v.ok) throw new Error('vendor')
    const c = await createConsultant(f.admin.db, f.firmId, {
      name: 'Vee',
      email: email(),
      type: 'vendor',
      vendorId: v.data.id,
    })
    expect(c.ok).toBe(true)
    const res = await deleteVendor(f.admin.db, f.firmId, v.data.id)
    expect(res).toEqual({
      ok: false,
      error: 'This vendor still has consultants. Reassign or remove them first.',
    })
    const { count } = await adminDb().from('vendors').select('id', { count: 'exact', head: true }).eq('id', v.data.id)
    expect(count).toBe(1)
  })
})

describe('consultants', () => {
  it('creates a vendor consultant with an initial cost rate', async () => {
    const f = await newFirm()
    const v = await createVendor(f.admin.db, f.firmId, { name: `V ${uniq()}` })
    if (!v.ok) throw new Error('vendor')
    const c = await createConsultant(f.manager.db, f.firmId, {
      name: 'Vee Vendor',
      email: email(),
      type: 'vendor',
      vendorId: v.data.id,
      initialHourlyCost: '95',
      initialCostFrom: '2026-01-01',
    })
    expect(c.ok).toBe(true)
    if (!c.ok) return
    const got = await getConsultant(f.manager.db, f.firmId, c.data.id)
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.data.costRates[0]).toMatchObject({ hourlyCost: '95.00', effectiveFrom: '2026-01-01' })
    expect(got.data.vendorName).toBeTruthy()
    expect(got.data.hasLogin).toBe(false)
  })

  it('employee with a vendor is rejected; nothing is created', async () => {
    const f = await newFirm()
    const v = await createVendor(f.admin.db, f.firmId, { name: `V ${uniq()}` })
    if (!v.ok) throw new Error('vendor')
    const res = await createConsultant(f.admin.db, f.firmId, {
      name: 'Emp',
      email: email(),
      type: 'employee',
      vendorId: v.data.id,
    })
    expect(res).toEqual({
      ok: false,
      error: 'Vendor contractors must be linked to a vendor, and other types must not be.',
    })
    expect(await consultantCount(f.firmId)).toBe(0)
  })

  it('duplicate email differing in case is rejected', async () => {
    const f = await newFirm()
    const mail = email()
    const a = await createConsultant(f.admin.db, f.firmId, { name: 'A', email: mail, type: 'employee', vendorId: null })
    expect(a.ok).toBe(true)
    const b = await createConsultant(f.admin.db, f.firmId, {
      name: 'B',
      email: mail.toUpperCase(),
      type: 'independent',
      vendorId: null,
    })
    expect(b).toEqual({ ok: false, error: 'A consultant with that email already exists.' })
    expect(await consultantCount(f.firmId)).toBe(1)
  })

  it('an invalid initial rate or date never inserts the consultant', async () => {
    const f = await newFirm()
    const base = { name: 'X', type: 'employee', vendorId: null } as const
    const bad = await createConsultant(f.admin.db, f.firmId, {
      ...base,
      email: email(),
      initialHourlyCost: '-5',
      initialCostFrom: '2026-01-01',
    })
    expect(bad.ok).toBe(false)
    const badDate = await createConsultant(f.admin.db, f.firmId, {
      ...base,
      email: email(),
      initialHourlyCost: '5',
      initialCostFrom: '2026-02-30',
    })
    expect(badDate.ok).toBe(false)
    const missingDate = await createConsultant(f.admin.db, f.firmId, {
      ...base,
      email: email(),
      initialHourlyCost: '5',
    })
    expect(missingDate.ok).toBe(false)
    expect(await consultantCount(f.firmId)).toBe(0)
  })

  it('rolls the consultant back when the cost-rate insert fails', async () => {
    const f = await newFirm()
    const real = f.admin.db
    const flaky = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === 'from') {
          return (table: string) =>
            table === 'consultant_cost_rates'
              ? {
                  insert: () => ({
                    select: () => ({
                      single: async () => ({
                        data: null,
                        error: { code: '23505', message: 'consultant_cost_rates_consultant_from_key' },
                      }),
                    }),
                  }),
                }
              : target.from(table)
        }
        return Reflect.get(target, prop, receiver)
      },
    }) as SupabaseClient
    const mail = email()
    const res = await createConsultant(flaky, f.firmId, {
      name: 'Half',
      email: mail,
      type: 'employee',
      vendorId: null,
      initialHourlyCost: '10',
      initialCostFrom: '2026-01-01',
    })
    expect(res).toEqual({ ok: false, error: 'A cost rate already starts on that date.' })
    expect(await consultantCount(f.firmId, mail)).toBe(0)
  })

  it('update and setConsultantActive; inactive hidden unless requested', async () => {
    const f = await newFirm()
    const c = await createConsultant(f.admin.db, f.firmId, {
      name: 'Z',
      email: email(),
      type: 'employee',
      vendorId: null,
    })
    if (!c.ok) throw new Error('c')
    const upd = await updateConsultant(f.manager.db, f.firmId, c.data.id, {
      name: 'Zed',
      email: email(),
      type: 'independent',
      vendorId: null,
    })
    expect(upd.ok).toBe(true)
    expect((await setConsultantActive(f.manager.db, f.firmId, c.data.id, false)).ok).toBe(true)
    const active = await listConsultants(f.manager.db, f.firmId)
    expect(active.ok && active.data).toEqual([])
    const all = await listConsultants(f.manager.db, f.firmId, { includeInactive: true })
    expect(all.ok && all.data.map((r) => r.name)).toEqual(['Zed'])
    const denied = await setConsultantActive(f.consultant.db, f.firmId, c.data.id, true)
    expect(denied).toEqual({ ok: false, error: DENIED })
    const { data } = await adminDb().from('consultants').select('active').eq('id', c.data.id).single()
    expect(data?.active).toBe(false)
  })
})

describe('cost rates', () => {
  async function setup() {
    const f = await newFirm()
    const c = await createConsultant(f.admin.db, f.firmId, {
      name: 'R',
      email: email(),
      type: 'employee',
      vendorId: null,
    })
    if (!c.ok) throw new Error('c')
    return { f, id: c.data.id }
  }

  it('same date twice fails; negative fails before the DB', async () => {
    const { f, id } = await setup()
    const first = await addCostRate(f.admin.db, f.firmId, id, { hourlyCost: '50', effectiveFrom: '2026-01-01' })
    expect(first.ok).toBe(true)
    const dup = await addCostRate(f.admin.db, f.firmId, id, { hourlyCost: '60', effectiveFrom: '2026-01-01' })
    expect(dup).toEqual({ ok: false, error: 'A cost rate already starts on that date.' })
    const neg = await addCostRate(f.admin.db, f.firmId, id, { hourlyCost: '-1', effectiveFrom: '2026-02-01' })
    expect(neg.ok).toBe(false)
    const { count } = await adminDb()
      .from('consultant_cost_rates')
      .select('id', { count: 'exact', head: true })
      .eq('consultant_id', id)
    expect(count).toBe(1)
  })

  it('lists rates newest first and currentCost uses the latest rate <= today', async () => {
    const { f, id } = await setup()
    await addCostRate(f.admin.db, f.firmId, id, { hourlyCost: '50', effectiveFrom: '2020-01-01' })
    await addCostRate(f.admin.db, f.firmId, id, { hourlyCost: '70.5', effectiveFrom: '2021-01-01' })
    await addCostRate(f.admin.db, f.firmId, id, { hourlyCost: '999', effectiveFrom: '2999-01-01' })
    const got = await getConsultant(f.admin.db, f.firmId, id)
    expect(got.ok && got.data.costRates.map((r) => r.effectiveFrom)).toEqual([
      '2999-01-01',
      '2021-01-01',
      '2020-01-01',
    ])
    const list = await listConsultants(f.admin.db, f.firmId)
    expect(list.ok && list.data[0]?.currentCost).toBe('70.50')
    expect(todayIso() < '2999-01-01').toBe(true)
  })

  it('currentCost is null when no rate has started', async () => {
    const { f, id } = await setup()
    await addCostRate(f.admin.db, f.firmId, id, { hourlyCost: '1', effectiveFrom: '2999-01-01' })
    const list = await listConsultants(f.admin.db, f.firmId)
    expect(list.ok && list.data[0]?.currentCost).toBeNull()
  })

  it('deleteCostRate is scoped to the firm and fails on zero rows', async () => {
    const { f, id } = await setup()
    const r = await addCostRate(f.admin.db, f.firmId, id, { hourlyCost: '50', effectiveFrom: '2026-01-01' })
    if (!r.ok) throw new Error('r')
    const other = await newFirm()
    const cross = await deleteCostRate(other.admin.db, other.firmId, r.data.id)
    expect(cross).toEqual({ ok: false, error: DENIED })
    const viaWrongFirm = await deleteCostRate(f.admin.db, other.firmId, r.data.id)
    expect(viaWrongFirm.ok).toBe(false)
    const { count } = await adminDb()
      .from('consultant_cost_rates')
      .select('id', { count: 'exact', head: true })
      .eq('id', r.data.id)
    expect(count).toBe(1)
    expect((await deleteCostRate(f.manager.db, f.firmId, r.data.id)).ok).toBe(true)
  })
})
