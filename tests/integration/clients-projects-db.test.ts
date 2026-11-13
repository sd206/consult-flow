import { describe, expect, it } from 'vitest'
import { adminDb, newFirm } from './helpers'

type Firm = Awaited<ReturnType<typeof newFirm>>

const text = (e: { message?: string; details?: string } | null) => `${e?.message} ${e?.details}`

async function mkClient(f: Firm, name = 'Globex') {
  const { data, error } = await f.manager.db
    .from('clients')
    .insert({ firm_id: f.firmId, name })
    .select()
    .single()
  expect(error).toBeNull()
  return data!
}

async function mkProject(f: Firm, clientId: string, name = 'Rollout', code: string | null = null) {
  const { data, error } = await f.manager.db
    .from('projects')
    .insert({ firm_id: f.firmId, client_id: clientId, name, code })
    .select()
    .single()
  expect(error).toBeNull()
  return data!
}

async function mkConsultant(f: Firm, userId?: string, name = 'Con Sultant') {
  const { data, error } = await f.admin.db
    .from('consultants')
    .insert({
      firm_id: f.firmId,
      name,
      email: `c-${crypto.randomUUID()}@test.local`,
      type: 'employee',
      ...(userId ? { user_id: userId } : {}),
    })
    .select()
    .single()
  expect(error).toBeNull()
  return data!
}

function assignment(f: Firm, projectId: string, consultantId: string, from: string, to?: string) {
  return f.manager.db
    .from('project_assignments')
    .insert({
      firm_id: f.firmId,
      project_id: projectId,
      consultant_id: consultantId,
      client_rate: 200,
      effective_from: from,
      ...(to ? { effective_to: to } : {}),
    })
    .select()
    .single()
}

describe('clients, projects, assignments', () => {
  it('manager creates client, project and open-ended assignment', async () => {
    const f = await newFirm()
    const client = await mkClient(f)
    expect(client.active).toBe(true)
    const project = await mkProject(f, client.id)
    expect(project.status).toBe('active')
    const c = await mkConsultant(f)
    const { data, error } = await assignment(f, project.id, c.id, '2026-01-01')
    expect(error).toBeNull()
    expect(Number(data!.client_rate)).toBe(200)
    expect(data!.effective_to).toBeNull()
  })

  it('rejects overlapping assignments; allows after closing; boundary overlap rejected', async () => {
    const f = await newFirm()
    const client = await mkClient(f)
    const project = await mkProject(f, client.id)
    const c = await mkConsultant(f)
    const { data: first, error: e0 } = await assignment(f, project.id, c.id, '2026-01-01')
    expect(e0).toBeNull()

    const { error: e1 } = await assignment(f, project.id, c.id, '2026-06-01')
    expect(e1?.code).toBe('23P01')
    expect(text(e1)).toContain('project_assignments_no_overlap')

    const { error: uErr } = await f.manager.db
      .from('project_assignments')
      .update({ effective_to: '2026-05-31' })
      .eq('id', first!.id)
    expect(uErr).toBeNull()
    const { error: e2 } = await assignment(f, project.id, c.id, '2026-06-01')
    expect(e2).toBeNull()

    const { error: e3 } = await assignment(f, project.id, c.id, '2026-05-31')
    expect(e3?.code).toBe('23P01')
    expect(text(e3)).toContain('project_assignments_no_overlap')

    const { data } = await adminDb()
      .from('project_assignments')
      .select('id')
      .eq('project_id', project.id)
    expect(data).toHaveLength(2)
  })

  it('rejects effective_to before effective_from', async () => {
    const f = await newFirm()
    const project = await mkProject(f, (await mkClient(f)).id)
    const c = await mkConsultant(f)
    const { error } = await assignment(f, project.id, c.id, '2026-06-01', '2026-05-01')
    expect(error?.code).toBe('23514')
    expect(text(error)).toContain('project_assignments_dates_chk')
  })

  it('rejects project end_date before start_date and negative rate', async () => {
    const f = await newFirm()
    const client = await mkClient(f)
    const { error } = await f.manager.db.from('projects').insert({
      firm_id: f.firmId,
      client_id: client.id,
      name: 'Bad',
      start_date: '2026-06-01',
      end_date: '2026-05-01',
    })
    expect(error?.code).toBe('23514')
    expect(text(error)).toContain('projects_dates_chk')
    const project = await mkProject(f, client.id)
    const c = await mkConsultant(f)
    const { error: rErr } = await f.manager.db.from('project_assignments').insert({
      firm_id: f.firmId,
      project_id: project.id,
      consultant_id: c.id,
      client_rate: -1,
      effective_from: '2026-01-01',
    })
    expect(rErr?.code).toBe('23514')
  })

  it('cannot delete a client that has projects', async () => {
    const f = await newFirm()
    const client = await mkClient(f)
    await mkProject(f, client.id)
    const { error } = await f.manager.db.from('clients').delete().eq('id', client.id)
    expect(error?.code).toBe('23503')
    expect(text(error)).toContain('projects_client_fk')
    const { data } = await adminDb().from('clients').select('id').eq('id', client.id)
    expect(data).toHaveLength(1)
  })

  it('project cannot reference another firm client', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const bClient = await mkClient(b)
    const { error } = await a.manager.db
      .from('projects')
      .insert({ firm_id: a.firmId, client_id: bClient.id, name: 'X' })
    expect(error?.code).toBe('23503')
    expect(text(error)).toContain('projects_client_fk')
    const { data } = await adminDb().from('projects').select('id').eq('firm_id', a.firmId)
    expect(data).toHaveLength(0)
  })

  it('rejects duplicate client name and project code (case-insensitive)', async () => {
    const f = await newFirm()
    const client = await mkClient(f, 'Initech')
    const { error } = await f.manager.db
      .from('clients')
      .insert({ firm_id: f.firmId, name: 'INITECH' })
    expect(error?.code).toBe('23505')
    expect(text(error)).toContain('clients_firm_name_key')
    await mkProject(f, client.id, 'P1', 'abc')
    const { error: pErr } = await f.manager.db
      .from('projects')
      .insert({ firm_id: f.firmId, client_id: client.id, name: 'P2', code: 'ABC' })
    expect(pErr?.code).toBe('23505')
    expect(text(pErr)).toContain('projects_firm_code_key')
    // null codes may repeat
    await mkProject(f, client.id, 'P3')
    await mkProject(f, client.id, 'P4')
  })

  it('consultant user sees nothing in base tables; my_assignments returns own, no rate', async () => {
    const f = await newFirm()
    const client = await mkClient(f, 'Globex')
    const project = await mkProject(f, client.id, 'Rollout', 'RO-1')
    const other = await mkProject(f, client.id, 'Secret', 'SE-1')
    const me = await mkConsultant(f, f.consultant.id, 'Me')
    const them = await mkConsultant(f, undefined, 'Them')
    const { error: a1 } = await assignment(f, project.id, me.id, '2026-01-01')
    const { error: a2 } = await assignment(f, other.id, them.id, '2026-01-01')
    expect(a1).toBeNull()
    expect(a2).toBeNull()

    for (const t of ['clients', 'projects', 'project_assignments'] as const) {
      const { data, error } = await f.consultant.db.from(t).select('id')
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    }

    const { data, error } = await f.consultant.db.rpc('my_assignments', { p_firm: f.firmId })
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    const row = data![0]
    expect(row.project_name).toBe('Rollout')
    expect(row.project_code).toBe('RO-1')
    expect(row.client_name).toBe('Globex')
    expect(row.effective_from).toBe('2026-01-01')
    expect(row.effective_to).toBeNull()
    expect(Object.keys(row)).not.toContain('client_rate')
    expect(JSON.stringify(data)).not.toContain('Secret')
  })

  it('another firm user calling my_assignments(firmA) gets nothing', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const project = await mkProject(a, (await mkClient(a)).id)
    const me = await mkConsultant(a, a.consultant.id)
    const { error: aErr } = await assignment(a, project.id, me.id, '2026-01-01')
    expect(aErr).toBeNull()
    for (const u of [b.consultant, b.manager]) {
      const { data, error } = await u.db.rpc('my_assignments', { p_firm: a.firmId })
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    }
  })

  it('manager of another firm sees none of firm A rows', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const client = await mkClient(a)
    const project = await mkProject(a, client.id)
    const c = await mkConsultant(a)
    await assignment(a, project.id, c.id, '2026-01-01')
    for (const t of ['clients', 'projects', 'project_assignments'] as const) {
      const { data: all } = await adminDb().from(t).select('id').eq('firm_id', a.firmId)
      expect(all!.length).toBeGreaterThan(0)
      const { data, error } = await b.manager.db.from(t).select('id')
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    }
  })

  it('assignment insert writes an audit_log row', async () => {
    const f = await newFirm()
    const project = await mkProject(f, (await mkClient(f)).id)
    const c = await mkConsultant(f)
    const { data: row } = await assignment(f, project.id, c.id, '2026-01-01')
    const { data } = await adminDb()
      .from('audit_log')
      .select('*')
      .eq('firm_id', f.firmId)
      .eq('entity_type', 'project_assignments')
      .eq('action', 'insert')
    expect(data).toHaveLength(1)
    expect(data![0].entity_id).toBe(row!.id)
    expect(data![0].actor_id).toBe(f.manager.id)
  })
})
