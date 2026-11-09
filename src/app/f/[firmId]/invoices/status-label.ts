import type { InvoiceStatus } from '@/lib/db-types'

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  partly_paid: 'Partly paid',
  paid: 'Paid',
  void: 'Void',
}

export const INVOICE_STATUSES = Object.keys(INVOICE_STATUS_LABEL) as InvoiceStatus[]
