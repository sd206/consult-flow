import { beforeAll, describe, expect, it } from 'vitest'
import { anonDb, newFirm } from './helpers'
import { issueManualInvoice } from './invoice-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>
type Row = {
  payment_id: string
  paid_on: string
  invoice_id: string
  invoice_number: string
  invoice_status: string
  client_id: string
  client_name: string
  method: string
  reference: string | null
  amount: string
  file_count: number
}

async function pay(f: Firm, invoiceId: string, amount: string, paidOn: string, method: string, reference: string | null) {
  const { data, error } = await f.manager.db.rpc('record_payment', {
    p_invoice: invoiceId,
    p_amount: amount,
    p_paid_on: paidOn,
    p_method: method,
    p_reference: reference,
    p_notes: null,
  })
  if (error || !data) throw new Error(`record_payment failed: ${error?.message}`)
  return data as string
}

const NONE = { p_from: null, p_to: null, p_client: null }

describe('payment list', () => {
  let f: Firm
  let other: Firm
  let a: { invoiceId: string; clientId: string }
  let b: { invoiceId: string; clientId: string }
  let c: { invoiceId: string; clientId: string }
  let p1: string
  let p2: string
  let p3: string
  let p4: string

  beforeAll(async () => {
    f = await newFirm('Payment List Firm')
    other = await newFirm('Payment List Other')
    a = await issueManualInvoice(f, 1000)
    b = await issueManualInvoice(f, 500)
    c = await issueManualInvoice(f, 200)
    p1 = await pay(f, a.invoiceId, '100.10', '2026-10-01', 'bank_transfer', 'R-OLD')
    p2 = await pay(f, a.invoiceId, '250.25', '2026-10-15', 'check', 'R-MID')
    p3 = await pay(f, b.invoiceId, '300.00', '2026-10-31', 'card', 'R-END')
    p4 = await pay(f, c.invoiceId, '200.00', '2026-10-31', 'cash', 'R-END2')
    const { error } = await f.manager.db.rpc('add_payment_attachment', {
      p_payment: p2,
      p_storage_path: `firms/${f.firmId}/attachments/payments/${p2}/${crypto.randomUUID()}.pdf`,
      p_file_name: 'r.pdf',
      p_mime: 'application/pdf',
      p_size: 10,
    })
    if (error) throw new Error(error.message)
  })

  const list = async (over: Record<string, unknown> = {}, firm = f.firmId) => {
    const { data, error } = await f.manager.db.rpc('list_payments', {
      p_firm: firm,
      ...NONE,
      p_limit: 50,
      p_offset: 0,
      ...over,
    })
    expect(error).toBeNull()
    return data as Row[]
  }
  const totals = async (over: Record<string, unknown> = {}) => {
    const { data, error } = await f.manager.db.rpc('payment_totals', { p_firm: f.firmId, ...NONE, ...over })
    expect(error).toBeNull()
    return (data as { total: string; payment_count: number }[])[0]
  }

  it('orders by paid_on desc, then created_at desc, and returns the joined columns', async () => {
    const rows = await list()
    expect(rows.map((r) => r.payment_id)).toEqual([p4, p3, p2, p1])
    expect(rows[2]).toMatchObject({
      paid_on: '2026-10-15',
      invoice_id: a.invoiceId,
      invoice_status: 'partly_paid',
      client_id: a.clientId,
      method: 'check',
      reference: 'R-MID',
      amount: '250.25',
    })
    expect(rows[2].invoice_number).toBeTruthy()
    expect(rows[2].client_name).toMatch(/^Client /)
  })

  it('filters dates inclusively', async () => {
    const rows = await list({ p_from: '2026-10-15', p_to: '2026-10-31' })
    expect(rows.map((r) => r.payment_id)).toEqual([p4, p3, p2])
    expect((await list({ p_from: '2026-10-16', p_to: '2026-10-30' })).length).toBe(0)
    expect((await list({ p_from: '2026-10-01', p_to: '2026-10-01' })).map((r) => r.payment_id)).toEqual([p1])
  })

  it('filters by client', async () => {
    expect((await list({ p_client: a.clientId })).map((r) => r.payment_id)).toEqual([p2, p1])
    expect((await list({ p_client: b.clientId })).map((r) => r.payment_id)).toEqual([p3])
  })

  it('pages with limit and offset', async () => {
    expect((await list({ p_limit: 2, p_offset: 1 })).map((r) => r.payment_id)).toEqual([p3, p2])
  })

  it('totals are exact strings and agree with the filters', async () => {
    expect(await totals()).toEqual({ total: '850.35', payment_count: 4 })
    expect(await totals({ p_from: '2026-10-15', p_to: '2026-10-31' })).toEqual({ total: '750.25', payment_count: 3 })
    expect(await totals({ p_client: a.clientId })).toEqual({ total: '350.35', payment_count: 2 })
    expect(await totals({ p_from: '2030-01-01' })).toEqual({ total: '0.00', payment_count: 0 })
  })

  it('counts attached files', async () => {
    const rows = await list()
    expect(Object.fromEntries(rows.map((r) => [r.payment_id, r.file_count]))).toEqual({
      [p1]: 0,
      [p2]: 1,
      [p3]: 0,
      [p4]: 0,
    })
  })

  it('refuses a consultant and another firm with 42501', async () => {
    const args = { ...NONE, p_limit: 50, p_offset: 0 }
    const asConsultant = await f.consultant.db.rpc('list_payments', { p_firm: f.firmId, ...args })
    expect(asConsultant.error?.code).toBe('42501')
    const asOther = await other.manager.db.rpc('list_payments', { p_firm: f.firmId, ...args })
    expect(asOther.error?.code).toBe('42501')
    const t1 = await f.consultant.db.rpc('payment_totals', { p_firm: f.firmId, ...NONE })
    expect(t1.error?.code).toBe('42501')
    const t2 = await other.manager.db.rpc('payment_totals', { p_firm: f.firmId, ...NONE })
    expect(t2.error?.code).toBe('42501')
  })

  it('is not callable anonymously', async () => {
    const { error } = await anonDb().rpc('list_payments', { p_firm: other.firmId, ...NONE, p_limit: 5, p_offset: 0 })
    expect(error).not.toBeNull()
  })
})
