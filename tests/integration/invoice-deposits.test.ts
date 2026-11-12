import { describe, expect, it } from 'vitest'
import { adminDb, newFirm } from './helpers'
import { issueManualInvoice } from './invoice-fixtures'
import { makeAccount, oneLine } from './bank-fixtures'

type Row = { line_id: string; amount: string; description: string; account_name: string; account_kind: string; exact_match: boolean }

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

describe('invoice_bank_deposits', () => {
  it('lists New deposits up to the balance, best matches first, within 90 days', async () => {
    const f = await newFirm('Deposits Firm')
    const inv = await issueManualInvoice(f, 1000)
    const { data: client } = await adminDb().from('invoices').select('clients(name)').eq('id', inv.invoiceId).single()
    const clientWord = ((client as unknown as { clients: { name: string } }).clients.name.split(' ')[0]).toUpperCase()
    const bank = await makeAccount(f, 'bank', 'Main checking')
    const card = await makeAccount(f, 'credit_card', 'Amex')

    const exact = await oneLine(f, bank, { posted_on: daysAgo(3), amount: '1000.00', description: 'WIRE IN' })
    const named = await oneLine(f, card, { posted_on: daysAgo(5), amount: '250.00', description: `ACH ${clientWord} PAYMENT` })
    const recent = await oneLine(f, bank, { posted_on: daysAgo(1), amount: '40.00', description: 'MISC DEPOSIT' })
    const older = await oneLine(f, bank, { posted_on: daysAgo(10), amount: '60.00', description: 'OLD DEPOSIT' })
    await oneLine(f, bank, { posted_on: daysAgo(2), amount: '1000.01', description: 'TOO BIG' })
    await oneLine(f, bank, { posted_on: daysAgo(2), amount: '-50.00', description: 'MONEY OUT' })
    await oneLine(f, bank, { posted_on: daysAgo(91), amount: '10.00', description: 'TOO OLD' })
    const ignored = await oneLine(f, bank, { posted_on: daysAgo(2), amount: '20.00', description: 'IGNORED' })
    await f.manager.db.rpc('ignore_bank_lines', { p_lines: [ignored], p_reason: null })

    const r = await f.manager.db.rpc('invoice_bank_deposits', { p_invoice: inv.invoiceId })
    expect(r.error).toBeNull()
    const rows = r.data as Row[]
    expect(rows.map((x) => x.line_id)).toEqual([exact, named, recent, older])
    expect(rows[0]).toMatchObject({ amount: '1000.00', account_name: 'Main checking', account_kind: 'bank', exact_match: true })
    expect(rows[1]).toMatchObject({ account_kind: 'credit_card', exact_match: false })
  })

  it('caps the list at 20 and refuses consultants and other firms', async () => {
    const f = await newFirm('Deposits Cap Firm')
    const inv = await issueManualInvoice(f, 1000)
    const bank = await makeAccount(f)
    for (let i = 0; i < 22; i++) await oneLine(f, bank, { posted_on: daysAgo(1), amount: `${i + 1}.00`, description: `DEP ${i}` })
    const r = await f.manager.db.rpc('invoice_bank_deposits', { p_invoice: inv.invoiceId })
    expect((r.data as Row[]).length).toBe(20)
    const other = await newFirm('Deposits Other')
    for (const db of [f.consultant.db, other.manager.db]) {
      const x = await db.rpc('invoice_bank_deposits', { p_invoice: inv.invoiceId })
      expect(x.error?.code).toBe('42501')
    }
  })
})
