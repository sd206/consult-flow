import { beforeAll, describe, expect, it } from 'vitest'
import { adminDb, newFirm } from './helpers'
import { issueManualInvoice } from './invoice-fixtures'
import { categoryId } from './expense-fixtures'
import { makeAccount, oneLine } from './bank-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>
const D = '2026-10-15'

async function line(id: string) {
  const { data } = await adminDb().from('bank_lines').select('status, payment_id, expense_id, ignore_reason').eq('id', id).single()
  return data
}

describe('mark_bank_lines_duplicate', () => {
  let f: Firm
  let acct: string

  beforeAll(async () => {
    f = await newFirm('Bank Bulk Firm')
    acct = await makeAccount(f)
  })

  it('links a line with exactly one match, ignores lines with none or several, and skips handled lines', async () => {
    const travel = await categoryId(f.firmId, 'Travel')
    const exp = (amount: string, spent_on: string, payee: string) =>
      f.manager.db.from('expenses').insert({ firm_id: f.firmId, spent_on, category_id: travel, payee, amount }).select('id').single()
    const one = (await exp('77.00', '2026-10-13', 'Cab')).data!.id
    await exp('55.00', '2026-10-14', 'Lunch A')
    await exp('55.00', '2026-10-16', 'Lunch B')

    const inv = await issueManualInvoice(f, 500)
    const pay = await f.manager.db.rpc('record_payment', {
      p_invoice: inv.invoiceId,
      p_amount: '300.00',
      p_paid_on: D,
      p_method: 'check',
      p_reference: null,
      p_notes: null,
    })

    const single = await oneLine(f, acct, { posted_on: D, amount: '-77.00', description: 'CAB' })
    const many = await oneLine(f, acct, { posted_on: D, amount: '-55.00', description: 'LUNCH' })
    const none = await oneLine(f, acct, { posted_on: D, amount: '-9.99', description: 'NOTHING' })
    const deposit = await oneLine(f, acct, { posted_on: D, amount: '300.00', description: 'CHECK DEPOSIT' })
    // A second line for the same expense: the expense is taken by `single`, so this one has no match left.
    const twin = await oneLine(f, acct, { posted_on: D, amount: '-77.00', description: 'CAB AGAIN' })
    const done = await oneLine(f, acct, { posted_on: D, amount: '-1.00', description: 'DONE' })
    await f.manager.db.rpc('ignore_bank_lines', { p_lines: [done], p_reason: 'x' })

    const r = await f.manager.db.rpc('mark_bank_lines_duplicate', { p_lines: [single, many, none, deposit, twin, done] })
    expect(r.error).toBeNull()
    expect(r.data).toEqual([{ matched: 2, ignored: 3, skipped: 1 }])

    expect(await line(single)).toMatchObject({ status: 'done', expense_id: one })
    expect(await line(deposit)).toMatchObject({ status: 'done', payment_id: pay.data })
    for (const id of [many, none, twin]) expect(await line(id)).toMatchObject({ status: 'ignored', ignore_reason: 'Duplicate' })
    expect(await line(done)).toMatchObject({ status: 'ignored', ignore_reason: 'x' })
  })

  it('refuses a consultant and another firm', async () => {
    const id = await oneLine(f, acct, { posted_on: D, amount: '-3.00', description: 'Z' })
    const other = await newFirm('Bank Bulk Other')
    for (const db of [f.consultant.db, other.manager.db]) {
      const r = await db.rpc('mark_bank_lines_duplicate', { p_lines: [id] })
      expect(r.error?.code).toBe('42501')
    }
    expect(await line(id)).toMatchObject({ status: 'new' })
  })
})
