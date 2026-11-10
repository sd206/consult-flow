import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATE_OPTIONS } from '@/modules/invoice-templates/schemas'
import type { TemplateRow } from '@/modules/invoice-templates/data'
import type { InvoiceDetail } from '../data'
import { buildInvoiceDocument, type ClientBilling, type FirmHeader } from './view-model'

const firm: FirmHeader = { name: 'Live Firm', address: '1 Live St', contactName: 'Liv', contactEmail: 'l@live.test', contactPhone: null }
const client: ClientBilling = { name: 'Live Client', contactName: null, email: null, phone: null, address: '9 Live Rd\nTown' }

const template = (over: Partial<TemplateRow['options']> = {}, layout: TemplateRow['baseLayout'] = 'classic'): TemplateRow => ({
  id: 't',
  name: 'T',
  baseLayout: layout,
  isDefault: true,
  options: { ...DEFAULT_TEMPLATE_OPTIONS, ...over },
})

const invoice = (over: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
  id: 'i1',
  number: 'INV-0001',
  clientName: 'Snap Client',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  issueDate: '2026-11-09',
  dueDate: '2026-12-09',
  status: 'issued',
  total: '977.31',
  currency: 'USD',
  clientId: 'c',
  templateId: 't',
  subject: 'October work',
  taxPercent: '8.25',
  subtotal: '977.31',
  discountType: 'none',
  discountValue: '0.00',
  discountLabel: null,
  discountAmount: '0.00',
  taxAmount: '0.00',
  amountPaid: '0.00',
  balanceDue: '0.00',
  pdfPath: null,
  billTo: { name: 'Snap Client', contactName: 'Snap Contact', email: 's@c.test', phone: null, address: '5 Snap Way' },
  from: { name: 'Snap Firm', address: '2 Snap St', contactName: null, contactEmail: 'f@snap.test', contactPhone: null, logoPath: null },
  lines: [
    {
      id: 'l1',
      kind: 'time',
      consultantId: 'k',
      consultantName: 'Con Sultant',
      projectId: 'p',
      projectName: 'Rollout',
      description: 'Rollout: Discovery; Workshop',
      quantity: '7.33',
      unitPrice: '133.33',
      amount: '977.31',
      sortOrder: 0,
    },
  ],
  consultantIds: ['k'],
  consultantFilter: null,
  ...over,
})

const entries = [
  { workDate: '2026-10-06', consultantName: 'Con Sultant', projectName: 'Rollout', hours: '4.00', note: 'Workshop' },
  { workDate: '2026-10-05', consultantName: 'Con Sultant', projectName: 'Rollout', hours: '3.33', note: 'Discovery' },
]

const build = (inv = invoice(), tpl = template()) =>
  buildInvoiceDocument({ invoice: inv, template: tpl, firm, client, logo: null, detailEntries: entries })

describe('buildInvoiceDocument', () => {
  it('uses snapshots for an issued invoice', () => {
    const d = build()
    expect(d.title).toBe('Invoice')
    expect(d.number).toBe('INV-0001')
    expect(d.from.name).toBe('Snap Firm')
    expect(d.from.addressLines).toEqual(['2 Snap St'])
    expect(d.billTo.name).toBe('Snap Client')
    expect(d.billTo.contactLines).toEqual(['Snap Contact', 's@c.test'])
  })

  it('uses live details for a draft preview', () => {
    const d = build(invoice({ status: 'draft', number: null, billTo: null, from: null }))
    expect(d.title).toBe('Draft invoice')
    expect(d.number).toBeNull()
    expect(d.from.name).toBe('Live Firm')
    expect(d.billTo.name).toBe('Live Client')
    expect(d.billTo.addressLines).toEqual(['9 Live Rd', 'Town'])
  })

  it('formats money, dates and tax label', () => {
    const d = build()
    expect(d.lines[0].amount).toBe('USD 977.31')
    expect(d.lines[0].rate).toBe('USD 133.33')
    expect(d.totals.total).toBe('USD 977.31')
    expect(d.totals.taxLabel).toBe('Tax (8.25%)')
    expect(d.issueDate).toBe('9 Nov 2026')
    expect(d.dueDate).toBe('9 Dec 2026')
    expect(d.period).toBe('1 Oct 2026 – 31 Oct 2026')
  })

  it('hides the rate column when showRate is false', () => {
    expect(build(invoice(), template({ showRate: false })).columns).toEqual({
      consultant: true,
      project: true,
      quantity: true,
      rate: false,
    })
  })

  it('shows the project name instead of notes when showTaskNotes is false', () => {
    expect(build().lines[0].description).toBe('Rollout: Discovery; Workshop')
    expect(build(invoice(), template({ showTaskNotes: false })).lines[0].description).toBe('Rollout')
  })

  it('includes daily detail in date order only when enabled', () => {
    expect(build().detail).toBeNull()
    const d = build(invoice(), template({ showDailyDetail: true }))
    expect(d.detail?.map((r) => r.date)).toEqual(['5 Oct 2026', '6 Oct 2026'])
    expect(d.detail?.[0]).toEqual({ date: '5 Oct 2026', consultant: 'Con Sultant', project: 'Rollout', hours: '3.33', note: 'Discovery' })
  })

  it('has no detail page when daily detail is on but there are no hours', () => {
    const d = buildInvoiceDocument({
      invoice: invoice(),
      template: template({ showDailyDetail: true }),
      firm,
      client,
      logo: null,
      detailEntries: [],
    })
    expect(d.detail).toBeNull()
  })

  it('payment terms fall back to the due date', () => {
    expect(build().paymentTerms).toBe('Payment due by 9 Dec 2026.')
    expect(build(invoice(), template({ paymentTermsText: 'Net 30' })).paymentTerms).toBe('Net 30')
  })

  it('formats a percentage discount, or none', () => {
    const d = build(invoice({ discountType: 'percent', discountValue: '10', discountLabel: 'Loyalty', discountAmount: '97.73' }))
    expect(d.totals.discountLabel).toBe('Loyalty (10%)')
    expect(d.totals.discount).toBe('-USD 97.73')
    const none = build()
    expect(none.totals.discountLabel).toBeNull()
    expect(none.totals.discount).toBeNull()
    const fixed = build(invoice({ discountType: 'amount', discountValue: '5', discountLabel: null, discountAmount: '5.00' }))
    expect(fixed.totals.discountLabel).toBe('Discount')
  })
})
