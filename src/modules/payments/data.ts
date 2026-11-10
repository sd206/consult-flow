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
