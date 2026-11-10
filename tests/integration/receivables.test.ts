import { beforeAll, describe, expect, it } from 'vitest'
import { todayIso } from '@/lib/domain/dates'
import { addDays } from '@/lib/domain/weeks'
import { getAgeing, getOutstandingSummary, listUnpaid } from '@/modules/receivables/data'
import { adminDb, newFirm } from './helpers'
import { issueManualInvoice } from './invoice-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>

function must<T>(r: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.data
}

async function setDue(invoiceId: string, daysOverdue: number) {
  const due = addDays(todayIso(), -daysOverdue)
  const { error } = await adminDb().from('invoices').update({ issue_date: due, due_date: due }).eq('id', invoiceId)
  if (error) throw new Error(error.message)
}

async function invoiceAt(f: Firm, amount: number, daysOverdue: number) {
  const ids = await issueManualInvoice(f, amount)
  await setDue(ids.invoiceId, daysOverdue)
  return ids
}

describe('receivables', () => {
  let f: Firm
  let overdue1Client: string
  beforeAll(async () => {
    f = await newFirm('Receivables Firm')
    await invoiceAt(f, 500, 0)
    overdue1Client = (await invoiceAt(f, 100, 1)).clientId
    await invoiceAt(f, 200, 30)
    await invoiceAt(f, 300, 31)
    await invoiceAt(f, 400, 90)
    const partly = await invoiceAt(f, 600, 91)
    const { error } = await f.manager.db.rpc('record_payment', {
      p_invoice: partly.invoiceId,
      p_amount: 250,
      p_paid_on: todayIso(),
      p_method: 'cash',
      p_reference: null,
      p_notes: null,
    })
    if (error) throw new Error(error.message)
    const paid = await invoiceAt(f, 777, 10)
    const { error: pErr } = await f.manager.db.rpc('record_payment', {
      p_invoice: paid.invoiceId,
      p_amount: 777,
      p_paid_on: todayIso(),
      p_method: 'cash',
      p_reference: null,
      p_notes: null,
    })
    if (pErr) throw new Error(pErr.message)
    const voided = await invoiceAt(f, 888, 20)
    const { error: vErr } = await f.manager.db.rpc('void_invoice', { p_invoice: voided.invoiceId })
    if (vErr) throw new Error(vErr.message)
  })

  it('ageing buckets use exact boundaries and balance due', async () => {
    const rows = must(await getAgeing(f.manager.db, f.firmId, null))
    expect(rows).toEqual([
      { bucket: 'current', balanceDue: '500.00', invoiceCount: 1 },
      { bucket: 'd1_30', balanceDue: '300.00', invoiceCount: 2 },
      { bucket: 'd31_60', balanceDue: '300.00', invoiceCount: 1 },
      { bucket: 'd61_90', balanceDue: '400.00', invoiceCount: 1 },
      { bucket: 'd90_plus', balanceDue: '350.00', invoiceCount: 1 },
    ])
  })

  it('lists unpaid invoices ordered by due date', async () => {
    const rows = must(await listUnpaid(f.manager.db, f.firmId, null))
    expect(rows).toHaveLength(6)
    expect(rows.map((r) => r.daysOverdue)).toEqual([91, 90, 31, 30, 1, 0])
    const partly = rows[0]
    expect(partly.total).toBe('600.00')
    expect(partly.amountPaid).toBe('250.00')
    expect(partly.balanceDue).toBe('350.00')
    expect(typeof partly.clientName).toBe('string')
    expect(partly.number).toBeTruthy()
  })

  it('filters by client', async () => {
    const rows = must(await listUnpaid(f.manager.db, f.firmId, overdue1Client))
    expect(rows).toHaveLength(1)
    expect(rows[0].balanceDue).toBe('100.00')
    const ageing = must(await getAgeing(f.manager.db, f.firmId, overdue1Client))
    expect(ageing.map((a) => [a.bucket, a.balanceDue, a.invoiceCount])).toEqual([
      ['current', '0.00', 0],
      ['d1_30', '100.00', 1],
      ['d31_60', '0.00', 0],
      ['d61_90', '0.00', 0],
      ['d90_plus', '0.00', 0],
    ])
  })

  it('outstanding summary', async () => {
    expect(must(await getOutstandingSummary(f.manager.db, f.firmId))).toEqual({
      outstanding: '1850.00',
      overdue: '1350.00',
      overdueCount: 5,
    })
  })

  it('a zero-total issued invoice is not unpaid and not overdue', async () => {
    const g = await newFirm('Zero Total Firm')
    const zero = await invoiceAt(g, 0, 10)
    const { data } = await adminDb().from('invoices').select('status, total::text').eq('id', zero.invoiceId).single()
    expect(data).toEqual({ status: 'issued', total: '0.00' })
    expect(must(await listUnpaid(g.manager.db, g.firmId, null))).toEqual([])
    const ageing = must(await getAgeing(g.manager.db, g.firmId, null))
    expect(ageing.every((b) => b.invoiceCount === 0 && b.balanceDue === '0.00')).toBe(true)
    expect(must(await getOutstandingSummary(g.manager.db, g.firmId))).toEqual({
      outstanding: '0.00',
      overdue: '0.00',
      overdueCount: 0,
    })
  })

  it('empty firm returns zeros', async () => {
    const g = await newFirm('Empty')
    expect(must(await getOutstandingSummary(g.admin.db, g.firmId))).toEqual({
      outstanding: '0.00',
      overdue: '0.00',
      overdueCount: 0,
    })
  })

  it('consultants are refused with 42501', async () => {
    for (const [fn, args] of [
      ['unpaid_invoices', { p_firm: f.firmId, p_client: null }],
      ['unpaid_ageing', { p_firm: f.firmId, p_client: null }],
      ['outstanding_summary', { p_firm: f.firmId }],
    ] as const) {
      const { error } = await f.consultant.db.rpc(fn, args)
      expect(error?.code, fn).toBe('42501')
    }
  })
})
