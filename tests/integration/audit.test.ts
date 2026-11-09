import { describe, expect, it } from 'vitest'
import { adminDb, newFirm } from './helpers'

describe('audit log', () => {
  it('records a role change with before/after and actor', async () => {
    const a = await newFirm()
    const { data: upd, error: updErr } = await a.admin.db
      .from('firm_members')
      .update({ role: 'consultant' })
      .eq('firm_id', a.firmId)
      .eq('user_id', a.manager.id)
      .select()
    expect(updErr).toBeNull()
    expect(upd).toHaveLength(1)

    const { data, error } = await a.admin.db
      .from('audit_log')
      .select('*')
      .eq('firm_id', a.firmId)
      .eq('entity_type', 'firm_members')
      .eq('action', 'update')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    const row = data![0]
    expect(row.actor_id).toBe(a.admin.id)
    expect(row.entity_id).toBe(upd![0].id)
    expect((row.before as { role: string }).role).toBe('manager')
    expect((row.after as { role: string }).role).toBe('consultant')
  })

  it('records deletes with null after', async () => {
    const a = await newFirm()
    const { data: del, error: delErr } = await a.admin.db
      .from('firm_members')
      .delete()
      .eq('firm_id', a.firmId)
      .eq('user_id', a.consultant.id)
      .select()
    expect(delErr).toBeNull()
    expect(del).toHaveLength(1)
    const { data } = await a.admin.db
      .from('audit_log')
      .select('*')
      .eq('firm_id', a.firmId)
      .eq('action', 'delete')
    expect(data).toHaveLength(1)
    expect(data![0].after).toBeNull()
    expect((data![0].before as { role: string }).role).toBe('consultant')
  })

  it('manager cannot read the audit log', async () => {
    const a = await newFirm()
    await a.admin.db
      .from('firm_members')
      .update({ role: 'consultant' })
      .eq('firm_id', a.firmId)
      .eq('user_id', a.manager.id)
    const { data: seen } = await adminDb()
      .from('audit_log')
      .select('id')
      .eq('firm_id', a.firmId)
    expect(seen!.length).toBeGreaterThan(0)
    const { data, error } = await a.manager.db.from('audit_log').select('*')
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('admin cannot write audit_log directly', async () => {
    const a = await newFirm()
    const count = async () => {
      const { count: c } = await adminDb()
        .from('audit_log')
        .select('*', { count: 'exact', head: true })
        .eq('firm_id', a.firmId)
      return c
    }
    const before = await count()
    const { error } = await a.admin.db.from('audit_log').insert({
      firm_id: a.firmId,
      entity_type: 'x',
      entity_id: a.firmId,
      action: 'insert',
    })
    expect(error).not.toBeNull()
    expect(await count()).toBe(before)
  })
})
