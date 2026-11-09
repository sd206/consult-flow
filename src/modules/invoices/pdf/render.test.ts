// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderInvoicePdf } from './render'
import type { InvoiceDocumentData } from './view-model'

const data = (layout: InvoiceDocumentData['layout'], withDetail = false): InvoiceDocumentData => ({
  title: 'Invoice',
  number: 'INV-0001',
  issueDate: '9 Nov 2026',
  dueDate: '9 Dec 2026',
  period: '1 Oct 2026 – 31 Oct 2026',
  subject: 'October work',
  from: { name: 'Firm', addressLines: ['1 St'], contactLines: ['a@b.test'], logo: null },
  billTo: { name: 'Client', addressLines: ['2 Rd'], contactLines: [] },
  columns: { consultant: true, project: true, quantity: true, rate: true },
  lines: [{ consultant: 'Con', project: 'Rollout', description: 'Rollout', quantity: '7.33', rate: 'USD 133.33', amount: 'USD 977.31' }],
  totals: {
    subtotal: 'USD 977.31',
    discountLabel: 'Loyalty (10%)',
    discount: '-USD 97.73',
    taxLabel: 'Tax (8.25%)',
    tax: 'USD 72.62',
    total: 'USD 952.20',
  },
  paymentTerms: 'Payment due by 9 Dec 2026.',
  footer: 'Thanks',
  layout,
  accentColor: '#112233',
  detail: withDetail
    ? Array.from({ length: 40 }, (_, i) => ({
        date: '5 Oct 2026',
        consultant: 'Con',
        project: 'Rollout',
        hours: '1.00',
        note: `Note ${i}`,
      }))
    : null,
})

const head = (b: Uint8Array) => Buffer.from(b.slice(0, 5)).toString('latin1')

describe('renderInvoicePdf', () => {
  it.each(['classic', 'modern', 'compact'] as const)('renders the %s layout', async (layout) => {
    expect(head(await renderInvoicePdf(data(layout)))).toBe('%PDF-')
  })

  it('renders an hours-detail page', async () => {
    const without = await renderInvoicePdf(data('classic'))
    const withDetail = await renderInvoicePdf(data('classic', true))
    expect(withDetail.length).toBeGreaterThan(without.length)
  })
})
