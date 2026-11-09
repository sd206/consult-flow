import { describe, expect, it } from 'vitest'
import { createConsultant, linkOrInviteConsultant, updateConsultant } from '@/modules/consultants/data'
import { inviteMember } from '@/modules/members/data'
import { adminDb, newFirm, newUser } from './helpers'

const REDIRECT = 'http://localhost:3000/auth/callback'

async function linkOf(consultantId: string): Promise<string | null> {
  const { data, error } = await adminDb().from('consultants').select('user_id').eq('id', consultantId).single()
  expect(error).toBeNull()
  return (data as { user_id: string | null }).user_id
}

async function memberCount(firmId: string, userId: string): Promise<number> {
  const { count, error } = await adminDb()
    .from('firm_members')
    .select('id', { count: 'exact', head: true })
    .eq('firm_id', firmId)
    .eq('user_id', userId)
  expect(error).toBeNull()
  return count ?? 0
}

const person = (email: string) => ({ name: 'Pat Person', email, type: 'employee' as const, vendorId: null })

describe('consultant <-> login linking', () => {
  it('member invited first, consultant created later: linked on create', async () => {
    const f = await newFirm()
    const u = await newUser('first')
    expect((await inviteMember(f.admin.db, adminDb(), f.firmId, { email: u.email, role: 'consultant' }, REDIRECT)).ok).toBe(
      true,
    )
    const c = await createConsultant(f.manager.db, f.firmId, person(u.email.toUpperCase()))
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(await linkOf(c.data.id)).toBe(u.id)
  })

  it('consultant created first, then invited to log in: linked', async () => {
    const f = await newFirm()
    const u = await newUser('later') // has an account (e.g. in another firm), not a member here
    const c = await createConsultant(f.manager.db, f.firmId, person(u.email))
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(await linkOf(c.data.id)).toBeNull()

    const r = await linkOrInviteConsultant(f.admin.db, adminDb(), f.firmId, c.data.id, REDIRECT)
    expect(r).toEqual({ ok: true, data: { outcome: 'added' } })
    expect(await linkOf(c.data.id)).toBe(u.id)
    expect(await memberCount(f.firmId, u.id)).toBe(1)
  })

  it('consultant created first, brand-new email invited: invited and linked', async () => {
    const f = await newFirm()
    const email = `fresh-${crypto.randomUUID()}@test.local`
    const c = await createConsultant(f.manager.db, f.firmId, person(email))
    expect(c.ok).toBe(true)
    if (!c.ok) return
    const r = await linkOrInviteConsultant(f.admin.db, adminDb(), f.firmId, c.data.id, REDIRECT)
    expect(r).toEqual({ ok: true, data: { outcome: 'invited' } })
    expect(await linkOf(c.data.id)).not.toBeNull()
  })

  it('manager who is also a consultant: created record links to the manager', async () => {
    const f = await newFirm()
    const c = await createConsultant(f.admin.db, f.firmId, person(f.manager.email))
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(await linkOf(c.data.id)).toBe(f.manager.id)
  })

  it('"Invite to log in" for an existing member links instead of failing', async () => {
    const f = await newFirm()
    // Inserted directly so it starts unlinked (as rows created before this fix would be).
    const { data: row } = await adminDb()
      .from('consultants')
      .insert({ firm_id: f.firmId, name: 'Mgr', email: f.manager.email, type: 'employee' })
      .select('id')
      .single()
    const id = (row as { id: string }).id
    const r = await linkOrInviteConsultant(f.admin.db, adminDb(), f.firmId, id, REDIRECT)
    expect(r).toEqual({ ok: true, data: { outcome: 'linked' } })
    expect(await linkOf(id)).toBe(f.manager.id)
    expect(await memberCount(f.firmId, f.manager.id)).toBe(1)
    const { data: m } = await adminDb()
      .from('firm_members')
      .select('role')
      .eq('firm_id', f.firmId)
      .eq('user_id', f.manager.id)
      .single()
    expect(m?.role).toBe('manager')
  })

  it('updating the email of an unlinked consultant to a member email links it', async () => {
    const f = await newFirm()
    const c = await createConsultant(f.manager.db, f.firmId, person(`x-${crypto.randomUUID()}@test.local`))
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(await linkOf(c.data.id)).toBeNull()
    expect((await updateConsultant(f.manager.db, f.firmId, c.data.id, person(f.consultant.email))).ok).toBe(true)
    expect(await linkOf(c.data.id)).toBe(f.consultant.id)
  })

  it("a consultant row in firm B is never linked by firm A's actions", async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const u = await newUser('shared')
    const { data: row } = await adminDb()
      .from('consultants')
      .insert({ firm_id: b.firmId, name: 'B Row', email: u.email, type: 'employee' })
      .select('id')
      .single()
    const bRow = (row as { id: string }).id

    // A invites the same email (any role), creates and edits its own record for it.
    expect((await inviteMember(a.admin.db, adminDb(), a.firmId, { email: u.email, role: 'manager' }, REDIRECT)).ok).toBe(
      true,
    )
    const aRow = await createConsultant(a.manager.db, a.firmId, person(u.email))
    expect(aRow.ok).toBe(true)
    if (!aRow.ok) return
    expect(await linkOf(aRow.data.id)).toBe(u.id)
    expect((await updateConsultant(a.manager.db, a.firmId, aRow.data.id, person(u.email))).ok).toBe(true)

    // A cannot act on B's record through the link-or-invite path either.
    const cross = await linkOrInviteConsultant(a.admin.db, adminDb(), a.firmId, bRow, REDIRECT)
    expect(cross.ok).toBe(false)
    const crossInB = await linkOrInviteConsultant(a.admin.db, adminDb(), b.firmId, bRow, REDIRECT)
    expect(crossInB.ok).toBe(false)

    expect(await linkOf(bRow)).toBeNull()
    expect(await memberCount(b.firmId, u.id)).toBe(0)
  })

  it('a member of firm B only is not linked by a firm A consultant record', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const c = await createConsultant(a.manager.db, a.firmId, person(b.manager.email))
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(await linkOf(c.data.id)).toBeNull()
  })
})
