import { adminDb, type newFirm } from './helpers'

type Firm = Awaited<ReturnType<typeof newFirm>>

// Both Mondays. PAST_WEEK is before "today"; FUTURE_WEEK is after it.
export const PAST_WEEK = '2026-10-05'
export const FUTURE_WEEK = '2027-01-04'

async function insertOne<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const { data, error } = await adminDb().from(table).insert(row).select().single()
  if (error || !data) throw new Error(`${table} insert failed: ${error?.message}`)
  return data as T
}

export async function seedTimesheetFixture(
  f: Firm,
  opts: {
    clientRate?: string
    costRate?: string
    costFrom?: string
    assignFrom?: string
    assignTo?: string | null
  } = {},
): Promise<{ clientId: string; projectId: string; consultantId: string; assignmentId: string }> {
  const client = await insertOne<{ id: string }>('clients', {
    firm_id: f.firmId,
    name: `Client ${crypto.randomUUID()}`,
  })
  const project = await insertOne<{ id: string }>('projects', {
    firm_id: f.firmId,
    client_id: client.id,
    name: 'Rollout',
  })
  const consultant = await insertOne<{ id: string }>('consultants', {
    firm_id: f.firmId,
    name: 'Con Sultant',
    email: `c-${crypto.randomUUID()}@test.local`,
    type: 'employee',
    user_id: f.consultant.id,
  })
  await insertOne('consultant_cost_rates', {
    firm_id: f.firmId,
    consultant_id: consultant.id,
    hourly_cost: opts.costRate ?? '90',
    effective_from: opts.costFrom ?? '2026-01-01',
  })
  const assignment = await insertOne<{ id: string }>('project_assignments', {
    firm_id: f.firmId,
    project_id: project.id,
    consultant_id: consultant.id,
    client_rate: opts.clientRate ?? '150',
    effective_from: opts.assignFrom ?? '2026-01-01',
    effective_to: opts.assignTo ?? null,
  })
  return {
    clientId: client.id,
    projectId: project.id,
    consultantId: consultant.id,
    assignmentId: assignment.id,
  }
}
