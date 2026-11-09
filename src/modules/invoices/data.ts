import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import type { InvoiceDiscountType, InvoiceLineKind, InvoiceStatus } from '@/lib/db-types'
import { fail, ok, type Result } from '@/lib/result'

const NOT_FOUND = 'Invoice not found.'

export type InvoiceListRow = {
  id: string
  number: string | null
  clientName: string
  periodStart: string
  periodEnd: string
  issueDate: string
  dueDate: string
  status: InvoiceStatus
  total: string
  currency: string
}

export type InvoiceLine = {
  id: string
  kind: InvoiceLineKind
  consultantId: string | null
  consultantName: string | null
  projectId: string | null
  projectName: string | null
  description: string
  quantity: string
  unitPrice: string
  amount: string
  sortOrder: number
}

export type InvoiceDetail = InvoiceListRow & {
  clientId: string
  templateId: string
  subject: string | null
  taxPercent: string
  subtotal: string
  discountType: InvoiceDiscountType
  discountValue: string
  discountLabel: string | null
  discountAmount: string
  taxAmount: string
  amountPaid: string
  pdfPath: string | null
  billTo: {
    name: string
    contactName: string | null
    email: string | null
    phone: string | null
    address: string | null
  } | null
  from: {
    name: string
    address: string | null
    contactName: string | null
    contactEmail: string | null
    contactPhone: string | null
    logoPath: string | null
  } | null
  lines: InvoiceLine[]
  consultantIds: string[]
}

export type Candidate = {
  consultantId: string
  consultantName: string
  projectId: string
  projectName: string
  rate: string
  hours: string
  entryCount: number
}

type NameJoin = { name: string } | { name: string }[] | null
const joinName = (v: NameJoin): string | null => (Array.isArray(v) ? v[0]?.name : v?.name) ?? null

const LIST_COLS =
  'id, number, period_start, period_end, issue_date, due_date, status, total::text, currency, created_at, clients(name)'

type ListDb = {
  id: string
  number: string | null
  period_start: string
  period_end: string
  issue_date: string
  due_date: string
  status: InvoiceStatus
  total: string
  currency: string
  created_at: string
  clients: NameJoin
}

const toListRow = (r: ListDb): InvoiceListRow => ({
  id: r.id,
  number: r.number,
  clientName: joinName(r.clients) ?? '',
  periodStart: r.period_start,
  periodEnd: r.period_end,
  issueDate: r.issue_date,
  dueDate: r.due_date,
  status: r.status,
  total: r.total,
  currency: r.currency,
})

/** Newest first: drafts, then issue date descending, then creation time descending. */
export async function listInvoices(
  db: SupabaseClient,
  firmId: string,
  opts?: { status?: InvoiceStatus },
): Promise<Result<InvoiceListRow[]>> {
  let q = db.from('invoices').select(LIST_COLS).eq('firm_id', firmId)
  if (opts?.status) q = q.eq('status', opts.status)
  const { data, error } = await q
  if (error) return fail(mapDbError(error))
  const rows = (data ?? []) as unknown as ListDb[]
  rows.sort((a, b) => {
    const da = a.status === 'draft' ? 0 : 1
    const dbb = b.status === 'draft' ? 0 : 1
    if (da !== dbb) return da - dbb
    if (a.issue_date !== b.issue_date) return a.issue_date < b.issue_date ? 1 : -1
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
  })
  return ok(rows.map(toListRow))
}

const DETAIL_COLS = `${LIST_COLS}, client_id, template_id, subject, tax_percent::text, subtotal::text, discount_type,
  discount_value::text, discount_label, discount_amount::text, tax_amount::text, amount_paid::text, pdf_path,
  bill_to_name, bill_to_contact_name, bill_to_email, bill_to_phone, bill_to_address,
  from_name, from_address, from_contact_name, from_contact_email, from_contact_phone, from_logo_path`

type DetailDb = ListDb & {
  client_id: string
  template_id: string
  subject: string | null
  tax_percent: string
  subtotal: string
  discount_type: InvoiceDiscountType
  discount_value: string
  discount_label: string | null
  discount_amount: string
  tax_amount: string
  amount_paid: string
  pdf_path: string | null
  bill_to_name: string | null
  bill_to_contact_name: string | null
  bill_to_email: string | null
  bill_to_phone: string | null
  bill_to_address: string | null
  from_name: string | null
  from_address: string | null
  from_contact_name: string | null
  from_contact_email: string | null
  from_contact_phone: string | null
  from_logo_path: string | null
}

type LineDb = {
  id: string
  kind: InvoiceLineKind
  consultant_id: string | null
  project_id: string | null
  description: string
  quantity: string
  unit_price: string
  amount: string
  sort_order: number
  consultants: NameJoin
  projects: NameJoin
}

export async function getInvoice(db: SupabaseClient, firmId: string, id: string): Promise<Result<InvoiceDetail>> {
  const { data, error } = await db.from('invoices').select(DETAIL_COLS).eq('firm_id', firmId).eq('id', id).maybeSingle()
  if (error) return fail(mapDbError(error))
  if (!data) return fail(NOT_FOUND)
  const r = data as unknown as DetailDb

  const { data: lineData, error: lErr } = await db
    .from('invoice_lines')
    .select(
      'id, kind, consultant_id, project_id, description, quantity::text, unit_price::text, amount::text, sort_order, consultants(name), projects(name)',
    )
    .eq('firm_id', firmId)
    .eq('invoice_id', id)
    .order('sort_order')
    .order('created_at')
  if (lErr) return fail(mapDbError(lErr))
  const lines: InvoiceLine[] = ((lineData ?? []) as unknown as LineDb[]).map((l) => ({
    id: l.id,
    kind: l.kind,
    consultantId: l.consultant_id,
    consultantName: joinName(l.consultants),
    projectId: l.project_id,
    projectName: joinName(l.projects),
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unit_price,
    amount: l.amount,
    sortOrder: l.sort_order,
  }))
  const consultantIds = [
    ...new Set(lines.filter((l) => l.kind === 'time' && l.consultantId).map((l) => l.consultantId as string)),
  ]

  return ok({
    ...toListRow(r),
    clientId: r.client_id,
    templateId: r.template_id,
    subject: r.subject,
    taxPercent: r.tax_percent,
    subtotal: r.subtotal,
    discountType: r.discount_type,
    discountValue: r.discount_value,
    discountLabel: r.discount_label,
    discountAmount: r.discount_amount,
    taxAmount: r.tax_amount,
    amountPaid: r.amount_paid,
    pdfPath: r.pdf_path,
    billTo:
      r.status === 'draft' || r.bill_to_name === null
        ? null
        : {
            name: r.bill_to_name,
            contactName: r.bill_to_contact_name,
            email: r.bill_to_email,
            phone: r.bill_to_phone,
            address: r.bill_to_address,
          },
    from:
      r.status === 'draft' || r.from_name === null
        ? null
        : {
            name: r.from_name,
            address: r.from_address,
            contactName: r.from_contact_name,
            contactEmail: r.from_contact_email,
            contactPhone: r.from_contact_phone,
            logoPath: r.from_logo_path,
          },
    lines,
    consultantIds,
  })
}

export async function listCandidates(
  db: SupabaseClient,
  firmId: string,
  clientId: string,
  start: string,
  end: string,
): Promise<Result<Candidate[]>> {
  const { data, error } = await db.rpc('invoice_candidates', {
    p_firm: firmId,
    p_client: clientId,
    p_start: start,
    p_end: end,
  })
  if (error) return fail(mapDbError(error))
  type Row = {
    consultant_id: string
    consultant_name: string
    project_id: string
    project_name: string
    rate: string
    hours: string
    entry_count: number
  }
  return ok(
    ((data ?? []) as Row[]).map((c) => ({
      consultantId: c.consultant_id,
      consultantName: c.consultant_name,
      projectId: c.project_id,
      projectName: c.project_name,
      rate: c.rate,
      hours: c.hours,
      entryCount: c.entry_count,
    })),
  )
}

async function rpcVoid(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Result<void>> {
  const { error } = await db.rpc(fn, args)
  if (error) return fail(mapDbError(error))
  return ok(undefined)
}

export async function createDraft(
  db: SupabaseClient,
  firmId: string,
  input: { clientId: string; periodStart: string; periodEnd: string; templateId: string; consultantIds: string[] | null },
): Promise<Result<{ id: string }>> {
  const { data, error } = await db.rpc('create_invoice_draft', {
    p_firm: firmId,
    p_client: input.clientId,
    p_start: input.periodStart,
    p_end: input.periodEnd,
    p_template: input.templateId,
    p_consultants: input.consultantIds,
  })
  if (error || !data) return fail(mapDbError(error))
  return ok({ id: data as string })
}

// Invoice-scoped RPCs take only the row id; the firm id is accepted for a uniform
// signature and enforced by the database (row lock + role check on the row's own firm).
export async function regenerateLines(
  db: SupabaseClient,
  _firmId: string,
  id: string,
  consultantIds: string[] | null,
): Promise<Result<void>> {
  return rpcVoid(db, 'regenerate_invoice_lines', { p_invoice: id, p_consultants: consultantIds })
}

export async function updateDraftHeader(
  db: SupabaseClient,
  _firmId: string,
  id: string,
  input: { subject: string | null; issueDate: string; dueDate: string; taxPercent: string; templateId: string },
): Promise<Result<void>> {
  return rpcVoid(db, 'update_invoice_draft', {
    p_invoice: id,
    p_subject: input.subject,
    p_issue_date: input.issueDate,
    p_due_date: input.dueDate,
    p_tax_percent: input.taxPercent,
    p_template: input.templateId,
  })
}

export async function updatePeriod(
  db: SupabaseClient,
  _firmId: string,
  id: string,
  input: { periodStart: string; periodEnd: string; consultantIds: string[] | null },
): Promise<Result<void>> {
  return rpcVoid(db, 'update_invoice_period', {
    p_invoice: id,
    p_start: input.periodStart,
    p_end: input.periodEnd,
    p_consultants: input.consultantIds,
  })
}

export async function setLineDescription(
  db: SupabaseClient,
  _firmId: string,
  lineId: string,
  description: string,
): Promise<Result<void>> {
  return rpcVoid(db, 'set_invoice_line_description', { p_line: lineId, p_description: description })
}

export async function saveManualLine(
  db: SupabaseClient,
  _firmId: string,
  invoiceId: string,
  input: { lineId: string | null; description: string; quantity: string; unitPrice: string },
): Promise<Result<void>> {
  return rpcVoid(db, 'save_manual_line', {
    p_invoice: invoiceId,
    p_line: input.lineId,
    p_description: input.description,
    p_quantity: input.quantity,
    p_unit_price: input.unitPrice,
  })
}

export async function deleteManualLine(db: SupabaseClient, _firmId: string, lineId: string): Promise<Result<void>> {
  return rpcVoid(db, 'delete_manual_line', { p_line: lineId })
}

export async function setDiscount(
  db: SupabaseClient,
  _firmId: string,
  id: string,
  input: { type: InvoiceDiscountType; value: string; label: string | null },
): Promise<Result<void>> {
  return rpcVoid(db, 'set_invoice_discount', {
    p_invoice: id,
    p_type: input.type,
    p_value: input.value,
    p_label: input.label,
  })
}

export async function deleteDraft(db: SupabaseClient, _firmId: string, id: string): Promise<Result<void>> {
  return rpcVoid(db, 'delete_invoice_draft', { p_invoice: id })
}

export async function issueInvoice(db: SupabaseClient, _firmId: string, id: string): Promise<Result<{ number: string }>> {
  const { data, error } = await db.rpc('issue_invoice', { p_invoice: id })
  if (error || typeof data !== 'string') return fail(mapDbError(error))
  return ok({ number: data })
}

export async function voidInvoice(db: SupabaseClient, _firmId: string, id: string): Promise<Result<void>> {
  return rpcVoid(db, 'void_invoice', { p_invoice: id })
}

export async function setInvoicePdf(db: SupabaseClient, _firmId: string, id: string, path: string): Promise<Result<void>> {
  return rpcVoid(db, 'set_invoice_pdf', { p_invoice: id, p_path: path })
}
