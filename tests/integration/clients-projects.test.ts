import { describe, expect, it } from 'vitest'
import { createClient, deleteClient, listClients, setClientActive, updateClient } from '@/modules/clients/data'
import { createConsultant } from '@/modules/consultants/data'
import {
  addAssignment,
  changeClientRate,
  createProject,
  endAssignment,
  getProject,
  listMyAssignments,
  listProjects,
  updateProject,
} from '@/modules/projects/data'
import { adminDb, newFirm } from './helpers'

type Firm = Awaited<ReturnType<typeof newFirm>>
const uniq = () => crypto.randomUUID().slice(0, 8)

async function setup(f: Firm) {
  const client = await createClient(f.manager.db, f.firmId, { name: `Client ${uniq()}` })
  if (!client.ok) throw new Error(client.error)
  const project = await createProject(f.manager.db, f.firmId, {
    clientId: client.data.id,
    name: 'Proj',
    status: 'active',
  })
  if (!project.ok) throw new Error(project.error)
  const consultant = await createConsultant(f.manager.db, f.firmId, {
    name: 'Cons',
    email: `c-${crypto.randomUUID()}@test.local`,
    type: 'employee',
    vendorId: null,
    initialHourlyCost: '90',
    initialCostFrom: '2026-01-01',
  })
  if (!consultant.ok) throw new Error(consultant.error)
  return { clientId: client.data.id, projectId: project.data.id, consultantId: consultant.data.id }
}

async function rows(projectId: string) {
  const { data, error } = await adminDb()
    .from('project_assignments')
    .select('id, client_rate:client_rate::text, effective_from, effective_to')
    .eq('project_id', projectId)
    .order('effective_from')
  expect(error).toBeNull()
  return data as { id: string; client_rate: string; effective_from: string; effective_to: string | null }[]
}

const RATE_MSG = "The new rate must start after the current rate's start date."

describe('clients', () => {
  it('creates, lists, updates, deactivates; duplicate rejected', async () => {
    const f = await newFirm()
    const name = `Acme ${uniq()}`
    const c = await createClient(f.manager.db, f.firmId, { name, billingEmail: ' b@x.com ' })
    expect(c.ok).toBe(true)
    if (!c.ok) return
    const dup = await createClient(f.manager.db, f.firmId, { name: name.toUpperCase() })
    expect(dup).toEqual({ ok: false, error: 'That name is already in use.' })
    expect((await updateClient(f.manager.db, f.firmId, c.data.id, { name: `${name} 2` })).ok).toBe(true)
    expect((await setClientActive(f.manager.db, f.firmId, c.data.id, false)).ok).toBe(true)
    const active = await listClients(f.manager.db, f.firmId)
    expect(active.ok && active.data.find((x) => x.id === c.data.id)).toBeFalsy()
    const all = await listClients(f.manager.db, f.firmId, { includeInactive: true })
    expect(all.ok && all.data.find((x) => x.id === c.data.id)?.name).toBe(`${name} 2`)
    expect((await deleteClient(f.manager.db, f.firmId, c.data.id)).ok).toBe(true)
  })

  it('consultant cannot list or create', async () => {
    const f = await newFirm()
    expect((await createClient(f.consultant.db, f.firmId, { name: 'X' })).ok).toBe(false)
    const l = await listClients(f.consultant.db, f.firmId)
    expect(l.ok && l.data).toEqual([])
  })

  it('deleteClient with a project fails', async () => {
    const f = await newFirm()
    const s = await setup(f)
    expect(await deleteClient(f.manager.db, f.firmId, s.clientId)).toEqual({
      ok: false,
      error: 'This client still has projects.',
    })
  })

  it('deleteClient from another firm fails and changes nothing', async () => {
    const f = await newFirm()
    const g = await newFirm()
    const s = await setup(f)
    const r = await deleteClient(g.manager.db, g.firmId, s.clientId)
    expect(r.ok).toBe(false)
    const { count } = await adminDb().from('clients').select('id', { count: 'exact', head: true }).eq('id', s.clientId)
    expect(count).toBe(1)
  })
})

describe('projects and assignments', () => {
  it('create client -> project -> assignment shows in getProject', async () => {
    const f = await newFirm()
    const s = await setup(f)
    const a = await addAssignment(f.manager.db, f.firmId, {
      projectId: s.projectId,
      consultantId: s.consultantId,
      clientRate: '180',
      effectiveFrom: '2026-01-01',
    })
    expect(a.ok).toBe(true)
    const p = await getProject(f.manager.db, f.firmId, s.projectId)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.data.assignments).toHaveLength(1)
    expect(p.data.assignments[0]).toMatchObject({
      consultantId: s.consultantId,
      consultantName: 'Cons',
      clientRate: '180.00',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    })
    const list = await listProjects(f.manager.db, f.firmId, { clientId: s.clientId, status: 'active' })
    expect(list.ok && list.data[0]?.clientName).toBeTruthy()
  })

  it('getProject for another firm fails', async () => {
    const f = await newFirm()
    const g = await newFirm()
    const s = await setup(f)
    expect((await getProject(g.manager.db, g.firmId, s.projectId)).ok).toBe(false)
  })

  it('changeClientRate ends old row and starts new; audit has both', async () => {
    const f = await newFirm()
    const s = await setup(f)
    const a = await addAssignment(f.manager.db, f.firmId, {
      projectId: s.projectId,
      consultantId: s.consultantId,
      clientRate: '180',
      effectiveFrom: '2026-01-01',
    })
    if (!a.ok) throw new Error(a.error)
    const c = await changeClientRate(f.manager.db, f.firmId, a.data.id, {
      clientRate: '200',
      effectiveFrom: '2026-07-01',
    })
    expect(c.ok).toBe(true)
    const r = await rows(s.projectId)
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ id: a.data.id, client_rate: '180.00', effective_to: '2026-06-30' })
    expect(r[1]).toMatchObject({ client_rate: '200.00', effective_from: '2026-07-01', effective_to: null })
    const { data: audit } = await adminDb()
      .from('audit_log')
      .select('action, entity_id')
      .eq('firm_id', f.firmId)
      .eq('entity_type', 'project_assignments')
    expect(audit?.filter((x) => x.action === 'update' && x.entity_id === a.data.id)).toHaveLength(1)
    expect(audit?.filter((x) => x.action === 'insert' && x.entity_id === (c.ok ? c.data.id : ''))).toHaveLength(1)
  })

  it('changeClientRate preserves a bounded effective_to', async () => {
    const f = await newFirm()
    const s = await setup(f)
    const a = await addAssignment(f.manager.db, f.firmId, {
      projectId: s.projectId,
      consultantId: s.consultantId,
      clientRate: '100',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
    })
    if (!a.ok) throw new Error(a.error)
    const c = await changeClientRate(f.manager.db, f.firmId, a.data.id, { clientRate: '110', effectiveFrom: '2026-04-01' })
    expect(c.ok).toBe(true)
    const r = await rows(s.projectId)
    expect(r[1]).toMatchObject({ effective_from: '2026-04-01', effective_to: '2026-12-31' })
  })

  it('changeClientRate with date <= current start fails, nothing changes', async () => {
    const f = await newFirm()
    const s = await setup(f)
    const a = await addAssignment(f.manager.db, f.firmId, {
      projectId: s.projectId,
      consultantId: s.consultantId,
      clientRate: '180',
      effectiveFrom: '2026-01-01',
    })
    if (!a.ok) throw new Error(a.error)
    expect(
      await changeClientRate(f.manager.db, f.firmId, a.data.id, { clientRate: '200', effectiveFrom: '2026-01-01' }),
    ).toEqual({ ok: false, error: RATE_MSG })
    expect(
      (await changeClientRate(f.manager.db, f.firmId, a.data.id, { clientRate: '200', effectiveFrom: '2025-12-01' })).ok,
    ).toBe(false)
    const r = await rows(s.projectId)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ client_rate: '180.00', effective_to: null })
  })

  it('changeClientRate fails when the old row ended before the new date', async () => {
    const f = await newFirm()
    const s = await setup(f)
    const a = await addAssignment(f.manager.db, f.firmId, {
      projectId: s.projectId,
      consultantId: s.consultantId,
      clientRate: '180',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-03-31',
    })
    if (!a.ok) throw new Error(a.error)
    expect(
      (await changeClientRate(f.manager.db, f.firmId, a.data.id, { clientRate: '200', effectiveFrom: '2026-06-01' })).ok,
    ).toBe(false)
    expect(await rows(s.projectId)).toHaveLength(1)
  })

  it('changeClientRate validates input and scopes to the firm', async () => {
    const f = await newFirm()
    const g = await newFirm()
    const s = await setup(f)
    const a = await addAssignment(f.manager.db, f.firmId, {
      projectId: s.projectId,
      consultantId: s.consultantId,
      clientRate: '180',
      effectiveFrom: '2026-01-01',
    })
    if (!a.ok) throw new Error(a.error)
    const id = a.data.id
    expect((await changeClientRate(f.manager.db, f.firmId, id, { clientRate: 'abc', effectiveFrom: '2026-07-01' })).ok).toBe(false)
    expect((await changeClientRate(f.manager.db, f.firmId, id, { clientRate: '200', effectiveFrom: 'nope' })).ok).toBe(false)
    expect((await changeClientRate(g.manager.db, g.firmId, id, { clientRate: '200', effectiveFrom: '2026-07-01' })).ok).toBe(false)
    expect((await changeClientRate(f.consultant.db, f.firmId, id, { clientRate: '200', effectiveFrom: '2026-07-01' })).ok).toBe(false)
    expect(await rows(s.projectId)).toHaveLength(1)
  })

  it('overlapping addAssignment gives the overlap message', async () => {
    const f = await newFirm()
    const s = await setup(f)
    const base = { projectId: s.projectId, consultantId: s.consultantId, clientRate: '180' }
    expect((await addAssignment(f.manager.db, f.firmId, { ...base, effectiveFrom: '2026-01-01' })).ok).toBe(true)
    expect(await addAssignment(f.manager.db, f.firmId, { ...base, effectiveFrom: '2026-05-01' })).toEqual({
      ok: false,
      error: 'This consultant already has a rate for this project in that date range.',
    })
    expect(await rows(s.projectId)).toHaveLength(1)
  })

  it('addAssignment rejects bad money/dates and cross-firm ids', async () => {
    const f = await newFirm()
    const g = await newFirm()
    const s = await setup(f)
    const base = { projectId: s.projectId, consultantId: s.consultantId, effectiveFrom: '2026-01-01' }
    expect((await addAssignment(f.manager.db, f.firmId, { ...base, clientRate: '-1' })).ok).toBe(false)
    expect((await addAssignment(f.manager.db, f.firmId, { ...base, clientRate: '1.234' })).ok).toBe(false)
    expect((await addAssignment(f.manager.db, f.firmId, { ...base, clientRate: '5', effectiveFrom: '2026-13-01' })).ok).toBe(false)
    expect((await addAssignment(f.manager.db, f.firmId, { ...base, clientRate: '5', effectiveTo: '2025-01-01' })).ok).toBe(false)
    expect((await addAssignment(g.manager.db, g.firmId, { ...base, clientRate: '5' })).ok).toBe(false)
    expect(await rows(s.projectId)).toHaveLength(0)
  })

  it('endAssignment sets effective_to and rejects earlier dates', async () => {
    const f = await newFirm()
    const s = await setup(f)
    const a = await addAssignment(f.manager.db, f.firmId, {
      projectId: s.projectId,
      consultantId: s.consultantId,
      clientRate: '180',
      effectiveFrom: '2026-03-01',
    })
    if (!a.ok) throw new Error(a.error)
    expect((await endAssignment(f.manager.db, f.firmId, a.data.id, '2026-02-28')).ok).toBe(false)
    expect((await endAssignment(f.manager.db, f.firmId, a.data.id, 'bad')).ok).toBe(false)
    expect((await rows(s.projectId))[0].effective_to).toBeNull()
    expect((await endAssignment(f.manager.db, f.firmId, a.data.id, '2026-06-30')).ok).toBe(true)
    expect((await rows(s.projectId))[0].effective_to).toBe('2026-06-30')
    expect((await endAssignment(f.manager.db, f.firmId, crypto.randomUUID(), '2026-06-30')).ok).toBe(false)
  })

  it('project endDate before startDate gives the date message; update too', async () => {
    const f = await newFirm()
    const s = await setup(f)
    const msg = 'The end date must be on or after the start date.'
    expect(
      await createProject(f.manager.db, f.firmId, {
        clientId: s.clientId,
        name: 'Bad',
        status: 'active',
        startDate: '2026-05-01',
        endDate: '2026-04-01',
      }),
    ).toEqual({ ok: false, error: msg })
    const u = await updateProject(f.manager.db, f.firmId, s.projectId, {
      clientId: s.clientId,
      name: 'Proj',
      status: 'closed',
      startDate: '2026-05-01',
      endDate: '2026-04-01',
    })
    expect(u).toEqual({ ok: false, error: msg })
    const { data } = await adminDb().from('projects').select('status').eq('id', s.projectId).single()
    expect(data?.status).toBe('active')
  })

  it('duplicate project code is rejected', async () => {
    const f = await newFirm()
    const s = await setup(f)
    const code = `P-${uniq()}`
    const mk = () => createProject(f.manager.db, f.firmId, { clientId: s.clientId, name: 'X', code, status: 'active' })
    expect((await mk()).ok).toBe(true)
    expect(await mk()).toEqual({ ok: false, error: 'That project code is already in use.' })
  })

  it('listMyAssignments returns only own assignments, no rates', async () => {
    const f = await newFirm()
    const s = await setup(f)
    await adminDb().from('consultants').update({ user_id: f.consultant.id }).eq('id', s.consultantId)
    const a = await addAssignment(f.manager.db, f.firmId, {
      projectId: s.projectId,
      consultantId: s.consultantId,
      clientRate: '180',
      effectiveFrom: '2026-01-01',
    })
    expect(a.ok).toBe(true)
    const mine = await listMyAssignments(f.consultant.db, f.firmId)
    expect(mine.ok).toBe(true)
    if (!mine.ok) return
    expect(mine.data).toHaveLength(1)
    expect(mine.data[0]).toMatchObject({ projectId: s.projectId, effectiveFrom: '2026-01-01' })
    expect(JSON.stringify(mine.data)).not.toContain('180')
  })
})
