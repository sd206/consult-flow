import { formatMoneyCode } from '@/lib/domain/money'
import type { InvoiceLayout } from '@/lib/db-types'
import type { TemplateRow } from '@/modules/invoice-templates/data'
import type { InvoiceDetail } from '../data'

export type FirmHeader = {
  name: string
  address: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
}

export type ClientBilling = {
  name: string
  contactName: string | null
  email: string | null
  phone: string | null
  address: string | null
}

export type InvoiceDocumentData = {
  title: 'Invoice' | 'Draft invoice'
  number: string | null
  issueDate: string
  dueDate: string
  period: string
  subject: string | null
  from: {
    name: string
    addressLines: string[]
    contactLines: string[]
    logo: { data: Uint8Array; format: 'png' | 'jpg' } | null
  }
  billTo: { name: string; addressLines: string[]; contactLines: string[] }
  columns: { consultant: boolean; project: boolean; quantity: boolean; rate: boolean }
  lines: { consultant: string; project: string; description: string; quantity: string; rate: string; amount: string }[]
  totals: {
    subtotal: string
    discountLabel: string | null
    discount: string | null
    taxLabel: string
    tax: string
    total: string
  }
  paymentTerms: string
  footer: string
  layout: InvoiceLayout
  accentColor: string
  detail: { date: string; consultant: string; project: string; hours: string; note: string }[] | null
}

export type DetailEntry = {
  workDate: string
  consultantName: string
  projectName: string
  hours: string
  note: string | null
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** `2026-11-09` -> `9 Nov 2026` (UTC, so the server's timezone never shifts the day). */
export function formatPdfDate(iso: string): string {
  return DATE_FMT.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)).replace('Sept', 'Sep')
}

const lines = (text: string | null): string[] =>
  (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

const present = (...vals: (string | null)[]): string[] => vals.map((v) => (v ?? '').trim()).filter(Boolean)

export function buildInvoiceDocument(input: {
  invoice: InvoiceDetail
  template: TemplateRow
  firm: FirmHeader
  client: ClientBilling
  logo: InvoiceDocumentData['from']['logo']
  detailEntries: DetailEntry[]
}): InvoiceDocumentData {
  const { invoice, template, logo } = input
  const o = template.options
  const money = (v: string) => formatMoneyCode(v, invoice.currency)
  const isDraft = invoice.status === 'draft'

  const from = invoice.from ?? {
    name: input.firm.name,
    address: input.firm.address,
    contactName: input.firm.contactName,
    contactEmail: input.firm.contactEmail,
    contactPhone: input.firm.contactPhone,
  }
  const billTo = invoice.billTo ?? input.client

  const billEmail = invoice.billTo ? invoice.billTo.email : input.client.email
  const billPhone = invoice.billTo ? invoice.billTo.phone : input.client.phone

  const hasDiscount = Number(invoice.discountAmount) > 0
  const discountBase = invoice.discountLabel?.trim() || 'Discount'

  const dueDate = formatPdfDate(invoice.dueDate)

  return {
    title: isDraft ? 'Draft invoice' : 'Invoice',
    number: isDraft ? null : invoice.number,
    issueDate: formatPdfDate(invoice.issueDate),
    dueDate,
    period: `${formatPdfDate(invoice.periodStart)} – ${formatPdfDate(invoice.periodEnd)}`,
    subject: invoice.subject,
    from: {
      name: from.name,
      addressLines: lines(from.address),
      contactLines: present(from.contactName, from.contactEmail, from.contactPhone),
      logo,
    },
    billTo: {
      name: billTo.name,
      addressLines: lines(billTo.address),
      contactLines: present(billTo.contactName, billEmail, billPhone),
    },
    columns: {
      consultant: o.showConsultant,
      project: o.showProject,
      quantity: o.showQuantity,
      rate: o.showRate,
    },
    lines: invoice.lines.map((l) => ({
      consultant: l.consultantName ?? '',
      project: l.projectName ?? '',
      description: l.kind === 'time' && !o.showTaskNotes ? (l.projectName ?? l.description) : l.description,
      quantity: l.quantity,
      rate: money(l.unitPrice),
      amount: money(l.amount),
    })),
    totals: {
      subtotal: money(invoice.subtotal),
      discountLabel: hasDiscount
        ? invoice.discountType === 'percent'
          ? `${discountBase} (${Number(invoice.discountValue)}%)`
          : discountBase
        : null,
      discount: hasDiscount ? `-${money(invoice.discountAmount)}` : null,
      taxLabel: `Tax (${Number(invoice.taxPercent)}%)`,
      tax: money(invoice.taxAmount),
      total: money(invoice.total),
    },
    paymentTerms: o.paymentTermsText.trim() || `Payment due by ${dueDate}.`,
    footer: o.footerText,
    layout: template.baseLayout,
    accentColor: o.accentColor,
    // No entries, no "Hours detail" page.
    detail: o.showDailyDetail && input.detailEntries.length > 0
      ? [...input.detailEntries]
          .sort(
            (a, b) =>
              a.workDate.localeCompare(b.workDate) ||
              a.consultantName.localeCompare(b.consultantName) ||
              a.projectName.localeCompare(b.projectName),
          )
          .map((e) => ({
            date: formatPdfDate(e.workDate),
            consultant: e.consultantName,
            project: e.projectName,
            hours: e.hours,
            note: e.note ?? '',
          }))
      : null,
  }
}
