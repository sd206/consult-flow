import { beforeAll, describe, expect, it } from 'vitest'
import { adminDb, newFirm } from './helpers'
import { issueManualInvoice } from './invoice-fixtures'
import { categoryId } from './expense-fixtures'
import { importLines, makeAccount, oneLine } from './bank-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>

const D = '2026-10-15'
const shift = (days: number) => new Date(Date.UTC(2026, 9, 15 + days)).toISOString().slice(0, 10)

async function lineRow(id: string) {
  const { data } = await adminDb().from('bank_lines').select('*').eq('id', id).single()
  return data as Record<string, unknown>
}

async function incomeCategory(f: Firm, name: string) {
  const { data } = await adminDb().from('other_income_categories').select('id').eq('firm_id', f.firmId).eq('name', name).single()
  return data!.id as string
}

describe('bank functions', () => {
  let f: Firm
  let other: Firm
  let bank: string
  let card: string

  beforeAll(async () => {
    f = await newFirm('Bank Fn Firm')
    other = await newFirm('Bank Fn Other')
    bank = await makeAccount(f, 'bank')
    card = await makeAccount(f, 'credit_card')
  })

  it('imports lines once; a re-upload counts duplicates', async () => {
    const acct = await makeAccount(f)
    const lines = [
      { posted_on: D, amount: '10.00', description: 'A', bank_ref: 'r1' },
      { posted_on: D, amount: '-20.00', description: 'B', bank_ref: 'r2' },
      { posted_on: D, amount: '30.00', description: 'C', bank_ref: 'r3' },
    ]
    expect(await importLines(f, acct, lines)).toMatchObject({ inserted: 3, duplicates: 0 })
    expect(await importLines(f, acct, lines)).toMatchObject({ inserted: 0, duplicates: 3 })
    const { data: imports } = await f.manager.db.from('bank_imports').select('line_count, duplicate_count').eq('account_id', acct).order('imported_at')
    expect(imports).toEqual([
      { line_count: 3, duplicate_count: 0 },
      { line_count: 0, duplicate_count: 3 },
    ])
  })

  it('refuses an inactive account and a consultant', async () => {
    const acct = await makeAccount(f)
    await f.manager.db.from('bank_accounts').update({ active: false }).eq('id', acct)
    await expect(importLines(f, acct, [{ posted_on: D, amount: '1.00', description: 'X' }])).rejects.toThrow('ACCOUNT_INACTIVE')
    const r = await f.consultant.db.rpc('import_bank_lines', { p_account: bank, p_file_name: 'x.ofx', p_format: 'ofx', p_lines: [] })
    expect(r.error?.code).toBe('42501')
    const r2 = await other.manager.db.rpc('import_bank_lines', { p_account: bank, p_file_name: 'x.ofx', p_format: 'ofx', p_lines: [] })
    expect(r2.error).not.toBeNull()
  })

  it('confirms a deposit as an invoice payment, once', async () => {
    const inv = await issueManualInvoice(f, 1000)
    const line = await oneLine(f, card, { posted_on: D, amount: '400.00', description: 'GLOBEX PAYMENT' })
    const r = await f.manager.db.rpc('confirm_bank_line_payment', { p_line: line, p_invoice: inv.invoiceId, p_notes: 'via bank' })
    expect(r.error).toBeNull()
    const { data: pay } = await adminDb().from('payments').select('amount, method, paid_on, notes').eq('id', r.data).single()
    expect(pay).toEqual({ amount: 400, method: 'card', paid_on: D, notes: 'via bank' })
    expect(await lineRow(line)).toMatchObject({ status: 'done', payment_id: r.data })
    const again = await f.manager.db.rpc('confirm_bank_line_payment', { p_line: line, p_invoice: inv.invoiceId, p_notes: null })
    expect(again.error?.message).toContain('LINE_HANDLED')
    const { count } = await adminDb().from('payments').select('id', { count: 'exact', head: true }).eq('invoice_id', inv.invoiceId)
    expect(count).toBe(1)
  })

  it('lets only one of two concurrent confirms through', async () => {
    const inv = await issueManualInvoice(f, 1000)
    const line = await oneLine(f, bank, { posted_on: D, amount: '100.00', description: 'RACE' })
    const call = () => f.manager.db.rpc('confirm_bank_line_payment', { p_line: line, p_invoice: inv.invoiceId, p_notes: null })
    const results = await Promise.all([call(), call()])
    expect(results.filter((x) => x.error === null)).toHaveLength(1)
    expect(results.find((x) => x.error)?.error?.message).toContain('LINE_HANDLED')
  })

  it('keeps the line new when the payment is refused', async () => {
    const inv = await issueManualInvoice(f, 50)
    const line = await oneLine(f, bank, { posted_on: D, amount: '80.00', description: 'TOO MUCH' })
    const r = await f.manager.db.rpc('confirm_bank_line_payment', { p_line: line, p_invoice: inv.invoiceId, p_notes: null })
    expect(r.error?.message).toContain('PAYMENT_TOO_LARGE')
    expect(await lineRow(line)).toMatchObject({ status: 'new', payment_id: null })
    const out = await oneLine(f, bank, { posted_on: D, amount: '-80.00', description: 'OUT' })
    const wrong = await f.manager.db.rpc('confirm_bank_line_payment', { p_line: out, p_invoice: inv.invoiceId, p_notes: null })
    expect(wrong.error?.message).toContain('LINE_DIRECTION')
    const foreign = await issueManualInvoice(other, 80)
    const cross = await f.manager.db.rpc('confirm_bank_line_payment', { p_line: line, p_invoice: foreign.invoiceId, p_notes: null })
    expect(cross.error).not.toBeNull()
  })

  it('confirms an expense with the right sign and date; refuses a retired category', async () => {
    const line = await oneLine(f, bank, { posted_on: D, amount: '-129.99', description: 'AWS EMEA' })
    const software = await categoryId(f.firmId, 'Software')
    const r = await f.manager.db.rpc('confirm_bank_line_expense', {
      p_line: line,
      p_payee: 'AWS',
      p_category: software,
      p_client: null,
      p_project: null,
      p_notes: 'hosting',
    })
    expect(r.error).toBeNull()
    const { data: exp } = await adminDb().from('expenses').select('amount, spent_on, payee, notes').eq('id', r.data).single()
    expect(exp).toEqual({ amount: 129.99, spent_on: D, payee: 'AWS', notes: 'hosting' })
    const line2 = await oneLine(f, bank, { posted_on: D, amount: '-5.00', description: 'X' })
    const retired = await categoryId(f.firmId, 'Office')
    await f.manager.db.from('expense_categories').update({ active: false }).eq('id', retired)
    const bad = await f.manager.db.rpc('confirm_bank_line_expense', {
      p_line: line2,
      p_payee: 'X',
      p_category: retired,
      p_client: null,
      p_project: null,
      p_notes: null,
    })
    expect(bad.error?.message).toContain('CATEGORY_RETIRED')
    await f.manager.db.from('expense_categories').update({ active: true }).eq('id', retired)
    expect(await lineRow(line2)).toMatchObject({ status: 'new' })
  })

  it('confirms other income', async () => {
    const line = await oneLine(f, bank, { posted_on: D, amount: '3.21', description: 'INTEREST' })
    const r = await f.manager.db.rpc('confirm_bank_line_other_income', {
      p_line: line,
      p_category: await incomeCategory(f, 'Interest'),
      p_source: 'First Bank',
      p_notes: null,
    })
    expect(r.error).toBeNull()
    expect(await lineRow(line)).toMatchObject({ status: 'done', other_income_id: r.data })
    const out = await oneLine(f, bank, { posted_on: D, amount: '-3.21', description: 'FEE' })
    const wrong = await f.manager.db.rpc('confirm_bank_line_other_income', {
      p_line: out,
      p_category: await incomeCategory(f, 'Interest'),
      p_source: 'Bank',
      p_notes: null,
    })
    expect(wrong.error?.message).toContain('LINE_DIRECTION')
  })

  it('links to an existing entry only when amounts match and it is not linked yet', async () => {
    const inv = await issueManualInvoice(f, 1000)
    const pay = await f.manager.db.rpc('record_payment', {
      p_invoice: inv.invoiceId,
      p_amount: '250.00',
      p_paid_on: D,
      p_method: 'check',
      p_reference: null,
      p_notes: null,
    })
    const mismatch = await oneLine(f, bank, { posted_on: D, amount: '249.00', description: 'CHECK DEP' })
    const m = await f.manager.db.rpc('link_bank_line', { p_line: mismatch, p_payment: pay.data, p_expense: null })
    expect(m.error?.message).toContain('LINK_MISMATCH')
    const a = await oneLine(f, bank, { posted_on: D, amount: '250.00', description: 'CHECK DEP' })
    const b = await oneLine(f, bank, { posted_on: D, amount: '250.00', description: 'CHECK DEP 2' })
    expect((await f.manager.db.rpc('link_bank_line', { p_line: a, p_payment: pay.data, p_expense: null })).error).toBeNull()
    const twice = await f.manager.db.rpc('link_bank_line', { p_line: b, p_payment: pay.data, p_expense: null })
    expect(twice.error?.message).toContain('ALREADY_LINKED')
    const both = await f.manager.db.rpc('link_bank_line', { p_line: b, p_payment: null, p_expense: null })
    expect(both.error).not.toBeNull()
  })

  it('ignores and resets lines', async () => {
    const x = await oneLine(f, bank, { posted_on: D, amount: '-500.00', description: 'TRANSFER' })
    const y = await oneLine(f, bank, { posted_on: D, amount: '-1.00', description: 'Y' })
    const r = await f.manager.db.rpc('ignore_bank_lines', { p_lines: [x, y], p_reason: 'Transfer' })
    expect(r.data).toBe(2)
    expect(await lineRow(x)).toMatchObject({ status: 'ignored', ignore_reason: 'Transfer' })
    const again = await f.manager.db.rpc('ignore_bank_lines', { p_lines: [x], p_reason: null })
    expect(again.data).toBe(0)
    expect((await f.manager.db.rpc('reset_bank_line', { p_line: x })).error).toBeNull()
    expect(await lineRow(x)).toMatchObject({ status: 'new', ignore_reason: null })
    const fresh = await f.manager.db.rpc('reset_bank_line', { p_line: x })
    expect(fresh.error?.message).toContain('LINE_HANDLED')
  })

  it('suggests open invoices, nearby unlinked entries and a remembered category', async () => {
    const g = await newFirm('Bank Suggest Firm')
    const acct = await makeAccount(g)
    const open = await issueManualInvoice(g, 777)
    const voided = await issueManualInvoice(g, 777)
    await g.manager.db.rpc('void_invoice', { p_invoice: voided.invoiceId })
    const pay = await g.manager.db.rpc('record_payment', {
      p_invoice: (await issueManualInvoice(g, 900)).invoiceId,
      p_amount: '120.00',
      p_paid_on: shift(7),
      p_method: 'check',
      p_reference: null,
      p_notes: null,
    })
    await g.manager.db.rpc('record_payment', {
      p_invoice: (await issueManualInvoice(g, 900)).invoiceId,
      p_amount: '120.00',
      p_paid_on: shift(8),
      p_method: 'check',
      p_reference: null,
      p_notes: null,
    })
    const dep = await oneLine(g, acct, { posted_on: D, amount: '120.00', description: 'DEP' })
    const c = await g.manager.db.rpc('bank_match_candidates', { p_line: dep })
    expect(c.error).toBeNull()
    const cand = c.data as { invoices: { id: string; balance_due: string }[]; payments: { id: string }[]; expenses: unknown[] }
    const ids = cand.invoices.map((i) => i.id)
    expect(ids).toContain(open.invoiceId)
    expect(ids).not.toContain(voided.invoiceId)
    expect(cand.payments.map((p) => p.id)).toEqual([pay.data])
    expect(cand.expenses).toEqual([])

    const travel = await categoryId(g.firmId, 'Travel')
    const first = await oneLine(g, acct, { posted_on: D, amount: '-40.00', description: 'METRO CABS' })
    await g.manager.db.rpc('confirm_bank_line_expense', {
      p_line: first,
      p_payee: 'Metro Cabs',
      p_category: travel,
      p_client: null,
      p_project: null,
      p_notes: null,
    })
    await oneLine(g, acct, { posted_on: D, amount: '-22.00', description: 'METRO CABS' })
    const list = await g.manager.db.rpc('list_bank_lines', { p_account: acct, p_status: 'new' })
    expect(list.error).toBeNull()
    const cab = (list.data as { description: string; suggested_category_id: string | null }[]).find((l) => l.description === 'METRO CABS')
    expect(cab?.suggested_category_id).toBe(travel)
    const done = await g.manager.db.rpc('list_bank_lines', { p_account: acct, p_status: 'done' })
    expect((done.data as { linked_label: string }[])[0].linked_label).toBe('Metro Cabs')
  })

  it('refuses every function to a consultant', async () => {
    const line = await oneLine(f, bank, { posted_on: D, amount: '1.00', description: 'Z' })
    const calls = [
      f.consultant.db.rpc('confirm_bank_line_payment', { p_line: line, p_invoice: line, p_notes: null }),
      f.consultant.db.rpc('confirm_bank_line_other_income', { p_line: line, p_category: line, p_source: 'x', p_notes: null }),
      f.consultant.db.rpc('ignore_bank_lines', { p_lines: [line], p_reason: null }),
      f.consultant.db.rpc('reset_bank_line', { p_line: line }),
      f.consultant.db.rpc('link_bank_line', { p_line: line, p_payment: line, p_expense: null }),
      f.consultant.db.rpc('list_bank_lines', { p_account: bank, p_status: 'new' }),
      f.consultant.db.rpc('bank_match_candidates', { p_line: line }),
      f.consultant.db.rpc('save_csv_mapping', { p_account: bank, p_mapping: {} }),
    ]
    for (const r of await Promise.all(calls)) expect(r.error?.code).toBe('42501')
  })
})
