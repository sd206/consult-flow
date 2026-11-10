import type { SupabaseClient } from '@supabase/supabase-js'
import { adminDb, type newFirm } from './helpers'

type Firm = Awaited<ReturnType<typeof newFirm>>

export type PnlIds = {
  globexId: string
  initechId: string
  portalId: string
  auditId: string
  danaId: string
  leeId: string
  /** Dana's approved week of 2026-03-02. */
  danaWeekId: string
  /** Lee's approved week of 2026-03-02. */
  leeWeekId: string
  /** Dana's submitted (not approved) week of 2026-03-09. */
  unapprovedWeekId: string
  invoiceAId: string | null
  invoiceBId: string | null
}

async function insertOne<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const { data, error } = await adminDb().from(table).insert(row).select().single()
  if (error || !data) throw new Error(`${table} insert failed: ${error?.message}`)
  return data as T
}

async function rpc<T = unknown>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn} failed: ${error.message}`)
  return data as T
}

async function categoryId(firmId: string, name: string): Promise<string> {
  const { data, error } = await adminDb()
    .from('expense_categories')
    .select('id')
    .eq('firm_id', firmId)
    .eq('name', name)
    .single()
  if (error || !data) throw new Error(`category lookup failed: ${error?.message}`)
  return (data as { id: string }).id
}

async function defaultTemplate(firmId: string): Promise<string> {
  const { data, error } = await adminDb()
    .from('invoice_templates')
    .select('id')
    .eq('firm_id', firmId)
    .eq('is_default', true)
    .single()
  if (error || !data) throw new Error(`default template lookup failed: ${error?.message}`)
  return (data as { id: string }).id
}

async function saveAndSubmit(
  db: SupabaseClient,
  firmId: string,
  consultantId: string,
  weekStart: string,
  entries: { projectId: string; workDate: string; hours: string }[],
): Promise<string> {
  const id = await rpc<string>(db, 'save_timesheet_week', {
    p_firm: firmId,
    p_consultant: consultantId,
    p_week_start: weekStart,
    p_entries: entries.map((e) => ({ ...e, note: null })),
  })
  await rpc(db, 'submit_timesheet', { p_timesheet: id })
  return id
}

/**
 * The Phase 6 P&L scenario (see the Task 1 brief): Globex/Portal and
 * Initech/Audit, approved March hours for Dana and Lee, an unapproved week,
 * Invoice A (Globex, issued 2026-04-10, 10% discount, 8.25% tax, 1000.00
 * paid 2026-05-05), Invoice B (Initech, issued 2026-04-15, then voided) and
 * three expenses (direct, client-only, overhead).
 *
 * `invoices: false` stops before invoicing, so the March weeks stay
 * uninvoiced and can be reopened.
 */
export async function seedPnlScenario(f: Firm, opts: { invoices?: boolean } = {}): Promise<PnlIds> {
  const db = adminDb()
  const { error: taxErr } = await db.from('firms').update({ default_tax_percent: 8.25 }).eq('id', f.firmId)
  if (taxErr) throw new Error(`firm tax update failed: ${taxErr.message}`)

  const globex = await insertOne<{ id: string }>('clients', { firm_id: f.firmId, name: 'Globex' })
  const initech = await insertOne<{ id: string }>('clients', { firm_id: f.firmId, name: 'Initech' })
  const portal = await insertOne<{ id: string }>('projects', {
    firm_id: f.firmId,
    client_id: globex.id,
    name: 'Portal',
  })
  const audit = await insertOne<{ id: string }>('projects', {
    firm_id: f.firmId,
    client_id: initech.id,
    name: 'Audit',
  })

  const dana = await insertOne<{ id: string }>('consultants', {
    firm_id: f.firmId,
    name: 'Dana',
    email: `dana-${crypto.randomUUID()}@test.local`,
    type: 'employee',
    user_id: f.consultant.id,
  })
  const lee = await insertOne<{ id: string }>('consultants', {
    firm_id: f.firmId,
    name: 'Lee',
    email: `lee-${crypto.randomUUID()}@test.local`,
    type: 'employee',
    user_id: null,
  })
  for (const [consultantId, cost] of [
    [dana.id, '90'],
    [lee.id, '120'],
  ]) {
    await insertOne('consultant_cost_rates', {
      firm_id: f.firmId,
      consultant_id: consultantId,
      hourly_cost: cost,
      effective_from: '2026-01-01',
    })
  }
  await insertOne('project_assignments', {
    firm_id: f.firmId,
    project_id: portal.id,
    consultant_id: dana.id,
    client_rate: '150',
    effective_from: '2026-01-01',
  })
  await insertOne('project_assignments', {
    firm_id: f.firmId,
    project_id: audit.id,
    consultant_id: lee.id,
    client_rate: '200',
    effective_from: '2026-01-01',
  })

  // Approved week of 2026-03-02. Dana enters her own time; Lee has no login,
  // so the manager enters it for him.
  const danaWeekId = await saveAndSubmit(f.consultant.db, f.firmId, dana.id, '2026-03-02', [
    { projectId: portal.id, workDate: '2026-03-02', hours: '6' },
    { projectId: portal.id, workDate: '2026-03-03', hours: '4' },
  ])
  const leeWeekId = await saveAndSubmit(f.manager.db, f.firmId, lee.id, '2026-03-02', [
    { projectId: audit.id, workDate: '2026-03-04', hours: '4' },
  ])
  await rpc(f.manager.db, 'approve_timesheet', { p_timesheet: danaWeekId })
  await rpc(f.manager.db, 'approve_timesheet', { p_timesheet: leeWeekId })

  // Submitted, never approved: must not count.
  const unapprovedWeekId = await saveAndSubmit(f.consultant.db, f.firmId, dana.id, '2026-03-09', [
    { projectId: portal.id, workDate: '2026-03-10', hours: '5' },
  ])

  // Expenses (the manager may write them; RLS allows admin/manager).
  const expenses = [
    { spent_on: '2026-03-20', category: 'Travel', amount: '120.00', client_id: globex.id, project_id: portal.id },
    { spent_on: '2026-03-25', category: 'Software', amount: '60.00', client_id: initech.id, project_id: null },
    { spent_on: '2026-04-02', category: 'Office', amount: '75.00', client_id: null, project_id: null },
  ]
  for (const e of expenses) {
    const { error } = await f.manager.db.from('expenses').insert({
      firm_id: f.firmId,
      spent_on: e.spent_on,
      category_id: await categoryId(f.firmId, e.category),
      payee: `${e.category} payee`,
      amount: e.amount,
      client_id: e.client_id,
      project_id: e.project_id,
    })
    if (error) throw new Error(`expense insert failed: ${error.message}`)
  }

  const ids: PnlIds = {
    globexId: globex.id,
    initechId: initech.id,
    portalId: portal.id,
    auditId: audit.id,
    danaId: dana.id,
    leeId: lee.id,
    danaWeekId,
    leeWeekId,
    unapprovedWeekId,
    invoiceAId: null,
    invoiceBId: null,
  }
  if (opts.invoices === false) return ids

  const template = await defaultTemplate(f.firmId)

  // Invoice A: Globex, March hours + Setup fee, 10% discount, 8.25% tax.
  const invoiceAId = await rpc<string>(f.manager.db, 'create_invoice_draft', {
    p_firm: f.firmId,
    p_client: globex.id,
    p_start: '2026-03-01',
    p_end: '2026-03-31',
    p_template: template,
    p_consultants: null,
  })
  await rpc(f.manager.db, 'save_manual_line', {
    p_invoice: invoiceAId,
    p_line: null,
    p_description: 'Setup fee',
    p_quantity: 1,
    p_unit_price: 300,
  })
  await rpc(f.manager.db, 'set_invoice_discount', {
    p_invoice: invoiceAId,
    p_type: 'percent',
    p_value: 10,
    p_label: null,
  })
  await rpc(f.manager.db, 'update_invoice_draft', {
    p_invoice: invoiceAId,
    p_subject: null,
    p_issue_date: '2026-04-10',
    p_due_date: '2026-05-10',
    p_tax_percent: 8.25,
    p_template: template,
  })
  await rpc(f.manager.db, 'issue_invoice', { p_invoice: invoiceAId })
  const { data: invA, error: invAErr } = await db
    .from('invoices')
    .select('subtotal, discount_amount, tax_amount, total')
    .eq('id', invoiceAId)
    .single()
  if (invAErr || !invA) throw new Error(`invoice A lookup failed: ${invAErr?.message}`)
  const a = invA as { subtotal: number; discount_amount: number; tax_amount: number; total: number }
  if (a.subtotal !== 1800 || a.discount_amount !== 180 || a.tax_amount !== 133.65 || a.total !== 1753.65) {
    throw new Error(`invoice A totals unexpected: ${JSON.stringify(a)}`)
  }
  await rpc(f.manager.db, 'record_payment', {
    p_invoice: invoiceAId,
    p_amount: 1000,
    p_paid_on: '2026-05-05',
    p_method: 'bank_transfer',
    p_reference: null,
    p_notes: null,
  })

  // Invoice B: Initech, Lee's 4 h, no tax, issued then voided.
  const invoiceBId = await rpc<string>(f.manager.db, 'create_invoice_draft', {
    p_firm: f.firmId,
    p_client: initech.id,
    p_start: '2026-03-01',
    p_end: '2026-03-31',
    p_template: template,
    p_consultants: null,
  })
  await rpc(f.manager.db, 'update_invoice_draft', {
    p_invoice: invoiceBId,
    p_subject: null,
    p_issue_date: '2026-04-15',
    p_due_date: '2026-05-15',
    p_tax_percent: 0,
    p_template: template,
  })
  await rpc(f.manager.db, 'issue_invoice', { p_invoice: invoiceBId })
  const { data: invB, error: invBErr } = await db.from('invoices').select('total').eq('id', invoiceBId).single()
  if (invBErr || !invB) throw new Error(`invoice B lookup failed: ${invBErr?.message}`)
  if ((invB as { total: number }).total !== 800) throw new Error(`invoice B total unexpected: ${JSON.stringify(invB)}`)
  await rpc(f.manager.db, 'void_invoice', { p_invoice: invoiceBId })

  return { ...ids, invoiceAId, invoiceBId }
}
