import { describe, expect, it } from 'vitest'
import { accountSchema, csvMappingSchema, expenseConfirmSchema, otherIncomeConfirmSchema } from './schemas'
import { rankInvoices } from './suggest'

const inv = (id: string, number: string, client_name: string, balance_due: string) => ({ id, number, client_name, balance_due })

describe('rankInvoices', () => {
  it('puts exact balance plus client name first, then exact balance, then the rest by number', () => {
    const list = [
      inv('a', 'INV-0004', 'Initech', '500.00'),
      inv('b', 'INV-0002', 'Globex Corporation', '1500.00'),
      inv('c', 'INV-0003', 'Initech', '1500.00'),
      inv('d', 'INV-0001', 'Acme', '20.00'),
      inv('e', 'INV-0005', 'Globex Corporation', '1500.00'),
    ]
    expect(rankInvoices('GLOBEX CORP PAYMENT – ACH CREDIT', list, '1500.00').map((i) => i.id)).toEqual([
      'b',
      'e',
      'c',
      'd',
      'a',
    ])
  })

  it('matches client names on whole words, ignoring case', () => {
    const list = [inv('x', 'INV-1', 'Ace', '10.00'), inv('y', 'INV-2', 'Space Co', '10.00')]
    expect(rankInvoices('payment from SPACE CO', list, '10.00').map((i) => i.id)).toEqual(['y', 'x'])
    expect(rankInvoices('PLACEHOLDER', [inv('z', 'INV-3', 'Ace', '10.00')], '10.00')[0].id).toBe('z')
  })
})

describe('bank schemas', () => {
  it('validates accounts', () => {
    expect(accountSchema.safeParse({ name: ' Main ', kind: 'bank', last4: '' }).data).toEqual({ name: 'Main', kind: 'bank', last4: null })
    expect(accountSchema.safeParse({ name: 'Card', kind: 'credit_card', last4: '12a4' }).success).toBe(false)
    expect(accountSchema.safeParse({ name: '', kind: 'bank', last4: '' }).success).toBe(false)
    expect(accountSchema.safeParse({ name: 'X', kind: 'savings', last4: '' }).success).toBe(false)
  })

  it('validates CSV mappings: columns must differ', () => {
    const base = { dateColumn: 0, dateFormat: 'MDY', descriptionColumn: 1 }
    expect(csvMappingSchema.safeParse({ ...base, amount: { mode: 'signed', column: 2, flip: true } }).success).toBe(true)
    expect(csvMappingSchema.safeParse({ ...base, amount: { mode: 'signed', column: 1, flip: false } }).success).toBe(false)
    expect(csvMappingSchema.safeParse({ ...base, amount: { mode: 'inout', inColumn: 2, outColumn: 2 } }).success).toBe(false)
    expect(csvMappingSchema.safeParse({ ...base, dateFormat: 'XYZ', amount: { mode: 'signed', column: 2, flip: false } }).success).toBe(false)
  })

  it('validates confirm forms', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(expenseConfirmSchema.safeParse({ payee: 'AWS', categoryId: id, clientId: '', projectId: '', notes: '' }).data).toEqual({
      payee: 'AWS',
      categoryId: id,
      clientId: null,
      projectId: null,
      notes: null,
    })
    expect(expenseConfirmSchema.safeParse({ payee: '', categoryId: id, clientId: '', projectId: '', notes: '' }).success).toBe(false)
    expect(otherIncomeConfirmSchema.safeParse({ source: 'x'.repeat(121), categoryId: id, notes: '' }).success).toBe(false)
  })
})
