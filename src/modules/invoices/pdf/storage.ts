import 'server-only'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import { fail, ok, type Result } from '@/lib/result'
import { createAdminDb } from '@/lib/supabase/admin'
import { getTemplate } from '@/modules/invoice-templates/data'
import { ensureInvoiceInFirm, getInvoice, setInvoicePdf, type InvoiceDetail } from '../data'
import { renderInvoicePdf } from './render'
import {
  buildInvoiceDocument,
  type ClientBilling,
  type DetailEntry,
  type FirmHeader,
  type InvoiceDocumentData,
} from './view-model'

const BUCKET = 'firm-files'
const PDF_FAILED = "The PDF couldn't be created."

type Logo = InvoiceDocumentData['from']['logo']

/** A missing, unreadable or unsupported logo is never an error: the PDF just has no logo. */
async function loadLogo(db: SupabaseClient, path: string | null): Promise<Logo> {
  if (!path) return null
  try {
    const { data, error } = await db.storage.from(BUCKET).download(path)
    if (error || !data) return null
    const bytes = new Uint8Array(await data.arrayBuffer())
    if (bytes.length > 3 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return { data: bytes, format: 'png' }
    if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return { data: bytes, format: 'jpg' }
    return null
  } catch {
    return null
  }
}

type NameJoin = { name: string } | { name: string }[] | null
const joinName = (v: NameJoin): string => (Array.isArray(v) ? v[0]?.name : v?.name) ?? ''

type TimesheetJoin = { consultant_id: string; consultants: NameJoin }
type EntryDb = {
  work_date: string
  hours: string
  note: string | null
  client_rate_snapshot: string | null
  project_id: string
  timesheets: TimesheetJoin | TimesheetJoin[] | null
  projects: { name: string } | { name: string }[] | null
}

/** Issued: entries linked to the invoice's lines. Draft: entries that its time lines would bill right now. */
async function loadDetailEntries(db: SupabaseClient, firmId: string, inv: InvoiceDetail): Promise<Result<DetailEntry[]>> {
  const timeLines = inv.lines.filter((l) => l.kind === 'time')
  if (timeLines.length === 0) return ok([])

  let q = db
    .from('time_entries')
    .select(
      'work_date, hours::text, note, client_rate_snapshot::text, project_id, timesheets!inner(consultant_id, status, consultants(name)), projects!inner(name, client_id)',
    )
    .eq('firm_id', firmId)
  if (inv.status === 'draft') {
    q = q
      .is('invoice_line_id', null)
      .eq('timesheets.status', 'approved')
      .eq('projects.client_id', inv.clientId)
      .gte('work_date', inv.periodStart)
      .lte('work_date', inv.periodEnd)
  } else {
    q = q.in(
      'invoice_line_id',
      timeLines.map((l) => l.id),
    )
  }
  const { data, error } = await q.order('work_date')
  if (error) return fail(mapDbError(error))

  const wanted = new Set(timeLines.map((l) => `${l.consultantId}|${l.projectId}|${Number(l.unitPrice)}`))
  const out: DetailEntry[] = []
  for (const e of (data ?? []) as unknown as EntryDb[]) {
    const ts = Array.isArray(e.timesheets) ? e.timesheets[0] : e.timesheets
    if (!ts) continue
    if (inv.status === 'draft' && !wanted.has(`${ts.consultant_id}|${e.project_id}|${Number(e.client_rate_snapshot)}`)) continue
    out.push({
      workDate: e.work_date,
      consultantName: joinName(ts.consultants),
      projectName: Array.isArray(e.projects) ? (e.projects[0]?.name ?? '') : (e.projects?.name ?? ''),
      hours: e.hours,
      note: e.note,
    })
  }
  return ok(out)
}

export async function loadInvoiceDocument(
  db: SupabaseClient,
  firmId: string,
  invoiceId: string,
): Promise<Result<InvoiceDocumentData>> {
  const inv = await getInvoice(db, firmId, invoiceId)
  if (!inv.ok) return inv
  const invoice = inv.data

  const tpl = await getTemplate(db, firmId, invoice.templateId)
  if (!tpl.ok) return tpl

  const { data: f, error: fErr } = await db
    .from('firms')
    .select('name, address, contact_name, contact_email, contact_phone, logo_path')
    .eq('id', firmId)
    .maybeSingle()
  if (fErr) return fail(mapDbError(fErr))
  if (!f) return fail('Invoice not found.')
  const firm: FirmHeader = {
    name: f.name as string,
    address: (f.address as string | null) ?? null,
    contactName: (f.contact_name as string | null) ?? null,
    contactEmail: (f.contact_email as string | null) ?? null,
    contactPhone: (f.contact_phone as string | null) ?? null,
  }

  const { data: c, error: cErr } = await db
    .from('clients')
    .select('name, billing_contact_name, billing_email, billing_phone, billing_address')
    .eq('firm_id', firmId)
    .eq('id', invoice.clientId)
    .maybeSingle()
  if (cErr) return fail(mapDbError(cErr))
  if (!c) return fail('Invoice not found.')
  const client: ClientBilling = {
    name: c.name as string,
    contactName: (c.billing_contact_name as string | null) ?? null,
    email: (c.billing_email as string | null) ?? null,
    phone: (c.billing_phone as string | null) ?? null,
    address: (c.billing_address as string | null) ?? null,
  }

  const logoPath = invoice.from ? invoice.from.logoPath : ((f.logo_path as string | null) ?? null)
  const logo = await loadLogo(db, logoPath)

  const detail: Result<DetailEntry[]> = tpl.data.options.showDailyDetail
    ? await loadDetailEntries(db, firmId, invoice)
    : ok([])
  if (!detail.ok) return detail

  return ok(buildInvoiceDocument({ invoice, template: tpl.data, firm, client, logo, detailEntries: detail.data }))
}

export async function generateAndStorePdf(
  db: SupabaseClient,
  firmId: string,
  invoiceId: string,
  render: (data: InvoiceDocumentData) => Promise<Uint8Array> = renderInvoicePdf,
): Promise<Result<{ path: string }>> {
  const doc = await loadInvoiceDocument(db, firmId, invoiceId)
  if (!doc.ok) return doc

  let bytes: Uint8Array
  try {
    bytes = await render(doc.data)
  } catch (e) {
    console.error('invoice PDF render failed', e)
    return fail(PDF_FAILED)
  }

  // Never upload into another firm's folder, even if the document loaded.
  const scope = await ensureInvoiceInFirm(db, firmId, invoiceId)
  if (!scope.ok) return scope

  const path = `firms/${firmId}/invoices/${invoiceId}/${randomUUID()}.pdf`
  const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf' })
  if (up.error) {
    console.error('invoice PDF upload failed', up.error)
    return fail(PDF_FAILED)
  }

  const set = await setInvoicePdf(db, firmId, invoiceId, path)
  if (!set.ok) {
    // Users can't delete invoice PDFs; the orphan goes via the service role (path built above, firm checked).
    const rm = await createAdminDb().storage.from(BUCKET).remove([path])
    if (rm.error) console.error('invoice PDF cleanup failed', rm.error)
    return set
  }
  return ok({ path })
}

export async function readStoredPdf(db: SupabaseClient, path: string): Promise<Result<Uint8Array>> {
  const { data, error } = await db.storage.from(BUCKET).download(path)
  if (error || !data) return fail('PDF not found.')
  return ok(new Uint8Array(await data.arrayBuffer()))
}
