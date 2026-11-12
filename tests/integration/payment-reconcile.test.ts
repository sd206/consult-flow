import { describe, expect, it } from 'vitest'
import { newFirm } from './helpers'
import { issueManualInvoice } from './invoice-fixtures'
import { makeAccount, oneLine } from './bank-fixtures'

type Row = { payment_id: string; bank_account: string | null }
const NONE = { p_from: null, p_to: null, p_client: null }

describe('payment list reconciliation', () => {
  it('marks payments matched to a bank line and filters by it, with matching totals', async () => {
    const f = await newFirm('Reconcile Firm')
    const inv = await issueManualInvoice(f, 1000)
    const pay = async (amount: string) =>
      (
        await f.manager.db.rpc('record_payment', {
          p_invoice: inv.invoiceId,
          p_amount: amount,
          p_paid_on: '2026-10-15',
          p_method: 'check',
          p_reference: null,
          p_notes: null,
        })
      ).data as string
    const matched = await pay('100.00')
    const open = await pay('40.00')
    const acct = await makeAccount(f, 'bank', 'Main checking')
    const line = await oneLine(f, acct, { posted_on: '2026-10-15', amount: '100.00', description: 'CHECK DEPOSIT' })
    expect((await f.manager.db.rpc('link_bank_line', { p_line: line, p_payment: matched, p_expense: null })).error).toBeNull()

    const list = async (bank: string) => {
      const r = await f.manager.db.rpc('list_payments', { p_firm: f.firmId, ...NONE, p_bank: bank, p_limit: 50, p_offset: 0 })
      expect(r.error).toBeNull()
      return r.data as Row[]
    }
    const totals = async (bank: string) =>
      ((await f.manager.db.rpc('payment_totals', { p_firm: f.firmId, ...NONE, p_bank: bank })).data as { total: string; payment_count: number }[])[0]

    const all = await list('all')
    expect(all.find((r) => r.payment_id === matched)?.bank_account).toBe('Main checking')
    expect(all.find((r) => r.payment_id === open)?.bank_account).toBeNull()
    expect((await list('unreconciled')).map((r) => r.payment_id)).toEqual([open])
    expect((await list('reconciled')).map((r) => r.payment_id)).toEqual([matched])
    expect(await totals('all')).toEqual({ total: '140.00', payment_count: 2 })
    expect(await totals('unreconciled')).toEqual({ total: '40.00', payment_count: 1 })
    expect(await totals('reconciled')).toEqual({ total: '100.00', payment_count: 1 })

    // Undo on the bank line makes the payment unreconciled again.
    await f.manager.db.rpc('reset_bank_line', { p_line: line })
    expect((await list('unreconciled')).map((r) => r.payment_id).sort()).toEqual([matched, open].sort())

    // Callers that don't pass p_bank still get every payment.
    const legacy = await f.manager.db.rpc('list_payments', { p_firm: f.firmId, ...NONE, p_limit: 50, p_offset: 0 })
    expect((legacy.data as Row[]).length).toBe(2)
  })
})
