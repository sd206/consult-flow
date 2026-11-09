import { describe, expect, it } from 'vitest'
import { adminDb, anonDb, newFirm, newUser } from './helpers'
import { createFirmWithAdmin } from '@/modules/firms/data'
import { changeMemberRole, inviteMember, listMembers, removeMember } from '@/modules/members/data'

const REDIRECT = 'http://localhost:3000/auth/callback'
const DENIED = "You don't have permission to do that."

async function newOwner() {
  const owner = await newUser('owner')
  const { error } = await adminDb()
    .from('profiles')
    .update({ is_platform_owner: true })
    .eq('user_id', owner.id)
  expect(error).toBeNull()
  return owner
}

async function memberRows(firmId: string, userId?: string) {
  let q = adminDb().from('firm_members').select('user_id, role').eq('firm_id', firmId)
  if (userId) q = q.eq('user_id', userId)
  const { data, error } = await q
  expect(error).toBeNull()
  return data ?? []
}

describe('createFirmWithAdmin', () => {
  it('creates the firm and an admin membership for a newly invited email', async () => {
    const email = `NewAdmin-${crypto.randomUUID()}@test.local`
    const res = await createFirmWithAdmin(
      adminDb(),
      { name: ' Fresh Firm ', adminEmail: `  ${email} ` },
      REDIRECT,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const { data: firm } = await adminDb().from('firms').select('name').eq('id', res.data.firmId).single()
    expect(firm?.name).toBe('Fresh Firm')
    const { data: prof } = await adminDb()
      .from('profiles')
      .select('user_id, email')
      .eq('email', email.toLowerCase())
      .single()
    expect(prof).not.toBeNull()
    expect(await memberRows(res.data.firmId)).toEqual([{ user_id: prof!.user_id, role: 'admin' }])
  })

  it('reuses an existing user, and leaves no firm behind on failure', async () => {
    const u = await newUser('existing')
    const res = await createFirmWithAdmin(
      adminDb(),
      { name: 'Existing Admin Firm', adminEmail: u.email.toUpperCase() },
      REDIRECT,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(await memberRows(res.data.firmId, u.id)).toHaveLength(1)

    const name = `Doomed ${crypto.randomUUID()}`
    const bad = await createFirmWithAdmin(adminDb(), { name, adminEmail: 'not-an-email' }, REDIRECT)
    expect(bad.ok).toBe(false)
    const { data } = await adminDb().from('firms').select('id').eq('name', name)
    expect(data).toEqual([])
  })

  it('platform owner sees the new firm via platform_list_firms', async () => {
    const owner = await newOwner()
    const name = `Listed ${crypto.randomUUID()}`
    const res = await createFirmWithAdmin(
      adminDb(),
      { name, adminEmail: `l-${crypto.randomUUID()}@test.local` },
      REDIRECT,
    )
    expect(res.ok).toBe(true)
    // Filter server-side: the full list is ordered oldest first and capped at max_rows.
    const { data, error } = await owner.db.rpc('platform_list_firms').eq('name', name)
    expect(error).toBeNull()
    expect((data as { name: string }[]).map((f) => f.name)).toEqual([name])
  })
})

describe('inviteMember', () => {
  it('existing user in another firm: ok, invited false, firm B untouched', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const res = await inviteMember(
      a.admin.db,
      adminDb(),
      a.firmId,
      { email: b.consultant.email, role: 'manager' },
      REDIRECT,
    )
    expect(res).toEqual({ ok: true, data: { userId: b.consultant.id, invited: false } })
    expect(await memberRows(a.firmId, b.consultant.id)).toEqual([
      { user_id: b.consultant.id, role: 'manager' },
    ])
    expect(await memberRows(b.firmId, b.consultant.id)).toEqual([
      { user_id: b.consultant.id, role: 'consultant' },
    ])
  })

  it('invites a brand new email (signup disabled still works for service role)', async () => {
    const a = await newFirm('A')
    const email = `brandnew-${crypto.randomUUID()}@test.local`
    const res = await inviteMember(a.admin.db, adminDb(), a.firmId, { email, role: 'consultant' }, REDIRECT)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.invited).toBe(true)
  })

  it('same email twice to the same firm fails and leaves one row', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const input = { email: b.consultant.email, role: 'consultant' as const }
    expect((await inviteMember(a.admin.db, adminDb(), a.firmId, input, REDIRECT)).ok).toBe(true)
    const again = await inviteMember(a.admin.db, adminDb(), a.firmId, input, REDIRECT)
    expect(again).toEqual({ ok: false, error: 'That person is already a member of this firm.' })
    expect(await memberRows(a.firmId, b.consultant.id)).toHaveLength(1)
  })

  it('manager and other-firm admin cannot invite', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const target = await newUser('target')
    const input = { email: target.email, role: 'consultant' as const }
    expect(await inviteMember(a.manager.db, adminDb(), a.firmId, input, REDIRECT)).toEqual({
      ok: false,
      error: DENIED,
    })
    expect(await inviteMember(b.admin.db, adminDb(), a.firmId, input, REDIRECT)).toEqual({
      ok: false,
      error: DENIED,
    })
    expect(await memberRows(a.firmId, target.id)).toHaveLength(0)
  })

  it('links a matching unlinked consultant record when role is consultant', async () => {
    const a = await newFirm('A')
    const target = await newUser('linkme')
    const { data: c, error } = await adminDb()
      .from('consultants')
      .insert({ firm_id: a.firmId, name: 'Link Me', email: target.email.toUpperCase(), type: 'employee' })
      .select('id')
      .single()
    expect(error).toBeNull()
    const res = await inviteMember(
      a.admin.db,
      adminDb(),
      a.firmId,
      { email: target.email, role: 'consultant' },
      REDIRECT,
    )
    expect(res.ok).toBe(true)
    const { data: after } = await adminDb().from('consultants').select('user_id').eq('id', c!.id).single()
    expect(after?.user_id).toBe(target.id)
  })

  it('links a matching unlinked consultant record for any role (e.g. manager)', async () => {
    const a = await newFirm('A')
    const target = await newUser('mgrlink')
    const { data: c } = await adminDb()
      .from('consultants')
      .insert({ firm_id: a.firmId, name: 'Mgr Link', email: target.email, type: 'employee' })
      .select('id')
      .single()
    const res = await inviteMember(a.admin.db, adminDb(), a.firmId, { email: target.email, role: 'manager' }, REDIRECT)
    expect(res.ok).toBe(true)
    const { data: after } = await adminDb().from('consultants').select('user_id').eq('id', c!.id).single()
    expect(after?.user_id).toBe(target.id)
  })

  it('audits the membership insert with the inviting admin as actor', async () => {
    const a = await newFirm('A')
    const target = await newUser('audited')
    const res = await inviteMember(a.admin.db, adminDb(), a.firmId, { email: target.email, role: 'consultant' }, REDIRECT)
    expect(res.ok).toBe(true)
    const { data: m } = await adminDb()
      .from('firm_members')
      .select('id')
      .eq('firm_id', a.firmId)
      .eq('user_id', target.id)
      .single()
    const { data: log, error } = await adminDb()
      .from('audit_log')
      .select('actor_id, action')
      .eq('entity_type', 'firm_members')
      .eq('entity_id', m!.id)
    expect(error).toBeNull()
    expect(log).toEqual([{ actor_id: a.admin.id, action: 'insert' }])
  })
})

describe('add_firm_member RPC', () => {
  it('a manager (or another firm admin) calling it directly fails and inserts nothing', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const target = await newUser('rpc')
    for (const caller of [a.manager, a.consultant, b.admin]) {
      const { data, error } = await caller.db.rpc('add_firm_member', {
        p_firm: a.firmId,
        p_user: target.id,
        p_role: 'admin',
      })
      expect(data).toBeNull()
      expect(error?.code).toBe('42501')
    }
    expect(await memberRows(a.firmId, target.id)).toHaveLength(0)
  })

  it('an admin calling it adds the member and gets the id back', async () => {
    const a = await newFirm('A')
    const target = await newUser('rpc-ok')
    const { data, error } = await a.admin.db.rpc('add_firm_member', {
      p_firm: a.firmId,
      p_user: target.id,
      p_role: 'manager',
    })
    expect(error).toBeNull()
    const { data: row } = await adminDb()
      .from('firm_members')
      .select('id, role')
      .eq('firm_id', a.firmId)
      .eq('user_id', target.id)
      .single()
    expect(row).toEqual({ id: data, role: 'manager' })
  })

  it('anon cannot execute it', async () => {
    const a = await newFirm('A')
    const { error } = await anonDb().rpc('add_firm_member', {
      p_firm: a.firmId,
      p_user: a.consultant.id,
      p_role: 'admin',
    })
    expect(error).not.toBeNull()
  })
})

describe('listMembers / changeMemberRole / removeMember', () => {
  it('lists members with email and role', async () => {
    const a = await newFirm('A')
    const res = await listMembers(a.admin.db, a.firmId)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data).toHaveLength(3)
    expect(res.data.find((m) => m.userId === a.manager.id)).toMatchObject({
      email: a.manager.email,
      role: 'manager',
    })
  })

  it('demoting the only admin fails with the last-admin message', async () => {
    const a = await newFirm('A')
    const res = await changeMemberRole(a.admin.db, a.firmId, a.admin.id, 'manager')
    expect(res).toEqual({ ok: false, error: 'A firm needs at least one Admin.' })
    expect(await memberRows(a.firmId, a.admin.id)).toEqual([{ user_id: a.admin.id, role: 'admin' }])
  })

  it('admin can change a role; manager cannot', async () => {
    const a = await newFirm('A')
    expect((await changeMemberRole(a.admin.db, a.firmId, a.consultant.id, 'manager')).ok).toBe(true)
    expect(await memberRows(a.firmId, a.consultant.id)).toEqual([
      { user_id: a.consultant.id, role: 'manager' },
    ])
    const denied = await changeMemberRole(a.manager.db, a.firmId, a.consultant.id, 'admin')
    expect(denied.ok).toBe(false)
    expect(await memberRows(a.firmId, a.consultant.id)).toEqual([
      { user_id: a.consultant.id, role: 'manager' },
    ])
  })

  it('removeMember removes others; fails for self and for non-admins', async () => {
    const a = await newFirm('A')
    expect((await removeMember(a.admin.db, a.firmId, a.admin.id)).ok).toBe(false)
    expect(await memberRows(a.firmId, a.admin.id)).toHaveLength(1)
    expect((await removeMember(a.manager.db, a.firmId, a.consultant.id)).ok).toBe(false)
    expect(await memberRows(a.firmId, a.consultant.id)).toHaveLength(1)
    expect((await removeMember(a.admin.db, a.firmId, a.consultant.id)).ok).toBe(true)
    expect(await memberRows(a.firmId, a.consultant.id)).toHaveLength(0)
  })
})
