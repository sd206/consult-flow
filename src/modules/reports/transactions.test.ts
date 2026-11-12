import { describe, expect, it } from 'vitest'
import { parseTxnParams, toTxnRow, txnTotals, type TxnParams } from './transactions'
import { buildTxnCsv } from './transactions-csv'

const payment = {
  kind: 'payment' as const,
  id: 'p1',
  txn_date: '2026-03-05',
  client_name: 'Globex',
  project_name: null,
  invoice_number: 'INV-0003',
  method: 'bank_transfer',
  reference: 'TRX-882',
  payee: null,
  category: 'Client payment',
  amount: '1500.00',
  notes: 'Paid early',
}
const expense = {
  kind: 'expense' as const,
  id: 'e1',
  txn_date: '2026-03-09',
  client_name: 'Globex',
  project_name: 'Portal',
  invoice_number: null,
  method: null,
  reference: null,
  payee: 'Delta Air',
  category: 'Travel',
  amount: '180.10',
  notes: null,
}

describe('transactions', () => {
  it('describes and signs payments and expenses', () => {
    expect(toTxnRow(payment)).toMatchObject({
      date: '2026-03-05',
      transaction: 'Payment – Globex, INV-0003 (Bank transfer, ref TRX-882)',
      category: 'Client payment',
      amount: '1500.00',
      notes: 'Paid early',
    })
    expect(toTxnRow(expense)).toMatchObject({
      transaction: 'Expense – Delta Air (Globex / Portal)',
      category: 'Travel',
      amount: '-180.10',
      notes: '',
    })
    expect(toTxnRow({ ...expense, client_name: null, project_name: null }).transaction).toBe('Expense – Delta Air')
  })

  it('totals in exact cents', () => {
    const rows = [toTxnRow(payment), toTxnRow(expense), toTxnRow({ ...expense, amount: '0.20' })]
    expect(txnTotals(rows)).toEqual({ moneyIn: '1500.00', moneyOut: '-180.30', net: '1319.70', count: 3 })
    expect(txnTotals([])).toEqual({ moneyIn: '0.00', moneyOut: '0.00', net: '0.00', count: 0 })
    expect(txnTotals([toTxnRow({ ...payment, amount: '0.05' }), toTxnRow({ ...expense, amount: '0.10' })]).net).toBe(
      '-0.05',
    )
  })

  it('parses params with defaults and rejects a reversed range', () => {
    expect(parseTxnParams({}, '2026-11-12')).toEqual({ ok: true, data: { from: '2026-01-01', to: '2026-11-12', kind: 'all' } })
    expect(parseTxnParams({ kind: 'out', from: '2026-02-01', to: '2026-02-28' }, '2026-11-12')).toMatchObject({
      ok: true,
      data: { kind: 'out' },
    })
    expect(parseTxnParams({ kind: 'bogus' }, '2026-11-12')).toMatchObject({ ok: true, data: { kind: 'all' } })
    expect(parseTxnParams({ from: '2026-05-01', to: '2026-04-01' }, '2026-11-12').ok).toBe(false)
  })

  it('builds the CSV with header, guarded text, totals and filename', () => {
    const params: TxnParams = { from: '2026-03-01', to: '2026-03-31', kind: 'all' }
    const rows = [toTxnRow(payment), toTxnRow({ ...expense, notes: '=SUM(A1), "taxi"' })]
    const { filename, body } = buildTxnCsv(rows, txnTotals(rows), params)
    expect(filename).toBe('transactions-2026-03-01-to-2026-03-31.csv')
    const l = body.replace(/^﻿/, '').split('\r\n')
    expect(l[0]).toBe('Date,Transaction,Category,Amount,Notes/Comments')
    expect(l[1]).toBe('2026-03-05,"Payment – Globex, INV-0003 (Bank transfer, ref TRX-882)",Client payment,1500.00,Paid early')
    expect(l[2]).toBe(`2026-03-09,Expense – Delta Air (Globex / Portal),Travel,-180.10,"'=SUM(A1), ""taxi"""`)
    expect(l.slice(4, 7)).toEqual([',Total money in,,1500.00,', ',Total money out,,-180.10,', ',Net,,1319.90,'])
    expect(buildTxnCsv([], txnTotals([]), { ...params, kind: 'out' }).filename).toBe(
      'transactions-2026-03-01-to-2026-03-31-money-out.csv',
    )
  })
})
