import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import type { AgeBucket } from '@/lib/domain/ageing'
import { fail, ok, type Result } from '@/lib/result'

export type UnpaidRow = {
  invoiceId: string
  number: string
  clientId: string
  clientName: string
  issueDate: string
  dueDate: string
  total: string
  amountPaid: string
  balanceDue: string
  daysOverdue: number
}

export type AgeingRow = { bucket: AgeBucket; balanceDue: string; invoiceCount: number }

export type OutstandingSummary = { outstanding: string; overdue: string; overdueCount: number }

type UnpaidDb = {
  invoice_id: string
  number: string
  client_id: string
  client_name: string
  issue_date: string
  due_date: string
  total: string
  amount_paid: string
  balance_due: string
  days_overdue: number
}

export async function listUnpaid(db: SupabaseClient, firmId: string, clientId: string | null): Promise<Result<UnpaidRow[]>> {
  const { data, error } = await db.rpc('unpaid_invoices', { p_firm: firmId, p_client: clientId })
  if (error) return fail(mapDbError(error))
  return ok(
    ((data ?? []) as UnpaidDb[]).map((r) => ({
      invoiceId: r.invoice_id,
      number: r.number,
      clientId: r.client_id,
      clientName: r.client_name,
      issueDate: r.issue_date,
      dueDate: r.due_date,
      total: r.total,
      amountPaid: r.amount_paid,
      balanceDue: r.balance_due,
      daysOverdue: r.days_overdue,
    })),
  )
}

export async function getAgeing(db: SupabaseClient, firmId: string, clientId: string | null): Promise<Result<AgeingRow[]>> {
  const { data, error } = await db.rpc('unpaid_ageing', { p_firm: firmId, p_client: clientId })
  if (error) return fail(mapDbError(error))
  return ok(
    ((data ?? []) as { bucket: AgeBucket; balance_due: string; invoice_count: number }[]).map((r) => ({
      bucket: r.bucket,
      balanceDue: r.balance_due,
      invoiceCount: r.invoice_count,
    })),
  )
}

export async function getOutstandingSummary(db: SupabaseClient, firmId: string): Promise<Result<OutstandingSummary>> {
  const { data, error } = await db.rpc('outstanding_summary', { p_firm: firmId })
  if (error) return fail(mapDbError(error))
  const row = ((data ?? []) as { outstanding: string; overdue: string; overdue_count: number }[])[0]
  if (!row) return fail(mapDbError(null))
  return ok({ outstanding: row.outstanding, overdue: row.overdue, overdueCount: row.overdue_count })
}
