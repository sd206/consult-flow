import { adminDb, type newFirm } from './helpers'

type Firm = Awaited<ReturnType<typeof newFirm>>

export type ApprovedHoursIds = {
  clientId: string
  projectId: string
  consultantId: string
  assignmentId: string
  timesheetId: string
}

async function insertOne<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const { data, error } = await adminDb().from(table).insert(row).select().single()
  if (error || !data) throw new Error(`${table} insert failed: ${error?.message}`)
  return data as T
}

/**
 * Creates client, project, consultant (linked to f.consultant), cost rate and
 * assignment, then saves + submits (consultant) and approves (manager) one week.
 * `beforeApprove` runs after submit and before approve (rate snapshots are taken
 * on approval).
 *
 * Options for more than one consultant per firm: `clientId` + `projectId` reuse
 * an existing client/project; `linkUser: false` creates a consultant with no
 * login (the manager saves and submits for them); `approve: false` stops after
 * submit.
 */
export async function seedApprovedHours(
  f: Firm,
  opts: {
    clientName?: string
    projectName?: string
    consultantName?: string
    clientRate?: string
    costRate?: string
    weekStart?: string
    entries: { workDate: string; hours: string; note?: string }[]
    beforeApprove?: (ids: ApprovedHoursIds) => Promise<void>
    clientId?: string
    projectId?: string
    linkUser?: boolean
    approve?: boolean
  },
): Promise<ApprovedHoursIds> {
  const weekStart = opts.weekStart ?? '2026-10-05'
  const linkUser = opts.linkUser ?? true
  const submitter = linkUser ? f.consultant : f.manager
  const client = opts.clientId
    ? { id: opts.clientId }
    : await insertOne<{ id: string }>('clients', {
        firm_id: f.firmId,
        name: opts.clientName ?? `Client ${crypto.randomUUID()}`,
      })
  const project = opts.projectId
    ? { id: opts.projectId }
    : await insertOne<{ id: string }>('projects', {
        firm_id: f.firmId,
        client_id: client.id,
        name: opts.projectName ?? 'Rollout',
      })
  const consultant = await insertOne<{ id: string }>('consultants', {
    firm_id: f.firmId,
    name: opts.consultantName ?? 'Con Sultant',
    email: `c-${crypto.randomUUID()}@test.local`,
    type: 'employee',
    user_id: linkUser ? f.consultant.id : null,
  })
  await insertOne('consultant_cost_rates', {
    firm_id: f.firmId,
    consultant_id: consultant.id,
    hourly_cost: opts.costRate ?? '80',
    effective_from: '2026-01-01',
  })
  const assignment = await insertOne<{ id: string }>('project_assignments', {
    firm_id: f.firmId,
    project_id: project.id,
    consultant_id: consultant.id,
    client_rate: opts.clientRate ?? '133.33',
    effective_from: '2026-01-01',
  })

  const { data: timesheetId, error: saveErr } = await submitter.db.rpc('save_timesheet_week', {
    p_firm: f.firmId,
    p_consultant: consultant.id,
    p_week_start: weekStart,
    p_entries: opts.entries.map((e) => ({
      projectId: project.id,
      workDate: e.workDate,
      hours: e.hours,
      note: e.note ?? null,
    })),
  })
  if (saveErr || !timesheetId) throw new Error(`save_timesheet_week failed: ${saveErr?.message}`)

  const { error: submitErr } = await submitter.db.rpc('submit_timesheet', {
    p_timesheet: timesheetId,
  })
  if (submitErr) throw new Error(`submit_timesheet failed: ${submitErr.message}`)

  const ids: ApprovedHoursIds = {
    clientId: client.id,
    projectId: project.id,
    consultantId: consultant.id,
    assignmentId: assignment.id,
    timesheetId: timesheetId as string,
  }
  if (opts.beforeApprove) await opts.beforeApprove(ids)
  if (opts.approve === false) return ids

  const { error: approveErr } = await f.manager.db.rpc('approve_timesheet', {
    p_timesheet: timesheetId,
  })
  if (approveErr) throw new Error(`approve_timesheet failed: ${approveErr.message}`)

  return ids
}

/** Inserts (service role) a draft invoice for the client with one manual line; returns the line id. */
export async function insertDraftInvoiceLine(firmId: string, clientId: string): Promise<string> {
  const db = adminDb()
  const { data: tpl, error: tErr } = await db
    .from('invoice_templates')
    .select('id')
    .eq('firm_id', firmId)
    .eq('is_default', true)
    .single()
  if (tErr || !tpl) throw new Error(`default template lookup failed: ${tErr?.message}`)
  const invoice = await insertOne<{ id: string }>('invoices', {
    firm_id: firmId,
    client_id: clientId,
    template_id: (tpl as { id: string }).id,
    period_start: '2026-10-01',
    period_end: '2026-10-31',
    issue_date: '2026-11-01',
    due_date: '2026-12-01',
    currency: 'USD',
  })
  const line = await insertOne<{ id: string }>('invoice_lines', {
    firm_id: firmId,
    invoice_id: invoice.id,
    kind: 'manual',
    description: 'Placeholder',
    quantity: '1',
    unit_price: '0',
    amount: '0',
  })
  return line.id
}

/**
 * Creates (manager) a draft for a new client with no time lines and one
 * manual line of 1 x `amount`; returns the invoice and client ids.
 */
export async function createManualDraft(
  f: Firm,
  amount: string | number = 1000,
): Promise<{ invoiceId: string; clientId: string }> {
  const db = adminDb()
  const client = await insertOne<{ id: string }>('clients', {
    firm_id: f.firmId,
    name: `Client ${crypto.randomUUID()}`,
  })
  const { data: tpl, error: tErr } = await db
    .from('invoice_templates')
    .select('id')
    .eq('firm_id', f.firmId)
    .eq('is_default', true)
    .single()
  if (tErr || !tpl) throw new Error(`default template lookup failed: ${tErr?.message}`)
  const { data: invoiceId, error } = await f.manager.db.rpc('create_invoice_draft', {
    p_firm: f.firmId,
    p_client: client.id,
    p_start: '2026-10-01',
    p_end: '2026-10-31',
    p_template: (tpl as { id: string }).id,
    p_consultants: [],
  })
  if (error || !invoiceId) throw new Error(`create_invoice_draft failed: ${error?.message}`)
  const { error: lErr } = await f.manager.db.rpc('save_manual_line', {
    p_invoice: invoiceId,
    p_line: null,
    p_description: 'Fee',
    p_quantity: 1,
    p_unit_price: amount,
  })
  if (lErr) throw new Error(`save_manual_line failed: ${lErr.message}`)
  return { invoiceId: invoiceId as string, clientId: client.id }
}

/** Creates and issues (manager) a manual-line-only invoice whose total is `amount`. */
export async function issueManualInvoice(
  f: Firm,
  amount: string | number = 1000,
): Promise<{ invoiceId: string; clientId: string }> {
  const ids = await createManualDraft(f, amount)
  const { error } = await f.manager.db.rpc('issue_invoice', { p_invoice: ids.invoiceId })
  if (error) throw new Error(`issue_invoice failed: ${error.message}`)
  return ids
}
