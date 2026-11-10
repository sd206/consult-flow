import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import type { PaymentMethod } from '@/lib/db-types'
import { fail, ok, type Result } from '@/lib/result'
import { removeOwnerFolder } from '@/modules/attachments/storage'
import { ensureInvoiceInFirm } from '@/modules/invoices/data'
const PAYMENT_NOT_FOUND = 'Payment not found.'

export type PaymentRow = {
  id: string
  amount: string
  paidOn: string
  method: PaymentMethod
  reference: string | null
  notes: string | null
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number }[]
}

export type PaymentDetails = { paidOn: string; method: PaymentMethod; reference: string | null; notes: string | null }

/** Payment-scoped RPCs take only the row id, so confirm it belongs to firmId first. */
export async function ensurePaymentInFirm(db: SupabaseClient, firmId: string, paymentId: string): Promise<Result<void>> {
  const { data, error } = await db.from('payments').select('id').eq('firm_id', firmId).eq('id', paymentId).maybeSingle()
  if (error) return fail(mapDbError(error))
  return data ? ok(undefined) : fail(PAYMENT_NOT_FOUND)
}

type PaymentDb = {
  id: string
  amount: string
  paid_on: string
  method: PaymentMethod
  reference: string | null
  notes: string | null
  attachments: { id: string; file_name: string; mime_type: string; size_bytes: number; created_at: string }[] | null
}

export async function listPayments(db: SupabaseClient, firmId: string, invoiceId: string): Promise<Result<PaymentRow[]>> {
  const scope = await ensureInvoiceInFirm(db, firmId, invoiceId)
  if (!scope.ok) return scope
  const { data, error } = await db
    .from('payments')
    .select(
      'id, amount::text, paid_on, method, reference, notes, created_at, attachments(id, file_name, mime_type, size_bytes, created_at)',
    )
    .eq('firm_id', firmId)
    .eq('invoice_id', invoiceId)
    .order('paid_on', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) return fail(mapDbError(error))
  return ok(
    ((data ?? []) as unknown as PaymentDb[]).map((p) => ({
      id: p.id,
      amount: p.amount,
      paidOn: p.paid_on,
      method: p.method,
      reference: p.reference,
      notes: p.notes,
      attachments: [...(p.attachments ?? [])]
        .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
        .map((a) => ({ id: a.id, fileName: a.file_name, mimeType: a.mime_type, sizeBytes: a.size_bytes })),
    })),
  )
}

export async function recordPayment(
  db: SupabaseClient,
  firmId: string,
  invoiceId: string,
  input: PaymentDetails & { amount: string },
): Promise<Result<{ id: string }>> {
  const scope = await ensureInvoiceInFirm(db, firmId, invoiceId)
  if (!scope.ok) return scope
  const { data, error } = await db.rpc('record_payment', {
    p_invoice: invoiceId,
    p_amount: input.amount,
    p_paid_on: input.paidOn,
    p_method: input.method,
    p_reference: input.reference,
    p_notes: input.notes,
  })
  if (error || typeof data !== 'string') return fail(mapDbError(error))
  return ok({ id: data })
}

export async function updatePaymentDetails(
  db: SupabaseClient,
  firmId: string,
  paymentId: string,
  input: PaymentDetails,
): Promise<Result<void>> {
  const scope = await ensurePaymentInFirm(db, firmId, paymentId)
  if (!scope.ok) return scope
  const { error } = await db.rpc('update_payment_details', {
    p_payment: paymentId,
    p_paid_on: input.paidOn,
    p_method: input.method,
    p_reference: input.reference,
    p_notes: input.notes,
  })
  if (error) return fail(mapDbError(error))
  return ok(undefined)
}

/**
 * Deletes the payment (and its attachment rows), then everything in its folder, including
 * abandoned uploads. A file cleanup failure is logged only.
 */
export async function deletePayment(db: SupabaseClient, firmId: string, paymentId: string): Promise<Result<void>> {
  const scope = await ensurePaymentInFirm(db, firmId, paymentId)
  if (!scope.ok) return scope
  const { error } = await db.rpc('delete_payment', { p_payment: paymentId })
  if (error) return fail(mapDbError(error))
  try {
    await removeOwnerFolder(firmId, { kind: 'payment', id: paymentId })
  } catch (e) {
    console.error('payment file cleanup failed', e)
  }
  return ok(undefined)
}

export const PAYMENT_PAGE_SIZE = 50

export type PaymentFilters = { from: string | null; to: string | null; clientId: string | null }

export type FirmPaymentRow = {
  paymentId: string
  paidOn: string
  invoiceId: string
  invoiceNumber: string
  invoiceStatus: string
  clientId: string
  clientName: string
  method: PaymentMethod
  reference: string | null
  amount: string
  fileCount: number
}

type FirmPaymentDb = {
  payment_id: string
  paid_on: string
  invoice_id: string
  invoice_number: string
  invoice_status: string
  client_id: string
  client_name: string
  method: PaymentMethod
  reference: string | null
  amount: string
  file_count: number
}

/** One page of every payment in the firm, plus the total and count for the same filters. */
export async function listAllPayments(
  db: SupabaseClient,
  firmId: string,
  filters: PaymentFilters,
  page = 1,
): Promise<Result<{ rows: FirmPaymentRow[]; total: string; count: number; pages: number }>> {
  const pageNo = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
  const args = { p_firm: firmId, p_from: filters.from, p_to: filters.to, p_client: filters.clientId }
  const [totals, list] = await Promise.all([
    db.rpc('payment_totals', args),
    db.rpc('list_payments', { ...args, p_limit: PAYMENT_PAGE_SIZE, p_offset: (pageNo - 1) * PAYMENT_PAGE_SIZE }),
  ])
  if (totals.error) return fail(mapDbError(totals.error))
  if (list.error) return fail(mapDbError(list.error))
  const t = (totals.data as { total: string; payment_count: number }[] | null)?.[0]
  if (!t) return fail(mapDbError(null))
  const rows = ((list.data ?? []) as FirmPaymentDb[]).map((r) => ({
    paymentId: r.payment_id,
    paidOn: r.paid_on,
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_number,
    invoiceStatus: r.invoice_status,
    clientId: r.client_id,
    clientName: r.client_name,
    method: r.method,
    reference: r.reference,
    amount: r.amount,
    fileCount: r.file_count,
  }))
  return ok({
    rows,
    total: t.total,
    count: t.payment_count,
    pages: Math.max(1, Math.ceil(t.payment_count / PAYMENT_PAGE_SIZE)),
  })
}
