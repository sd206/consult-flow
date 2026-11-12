import { beforeAll, describe, expect, it } from 'vitest'
import { adminDb, newFirm } from './helpers'
import { categoryId } from './expense-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>
type Row = { kind: string; txn_date: string; payee: string | null; category: string; amount: string }

describe('transactions_report with other income', () => {
  let f: Firm
  let other: Firm

  beforeAll(async () => {
    f = await newFirm('Txn Report Firm')
    other = await newFirm('Txn Report Other')
    const db = adminDb()
    const { data: cat } = await db.from('other_income_categories').select('id').eq('firm_id', f.firmId).eq('name', 'Interest').single()
    await db.from('other_income').insert({ firm_id: f.firmId, received_on: '2026-10-02', category_id: cat!.id, source: 'First Bank', amount: '3.21' })
    await db.from('expenses').insert({
      firm_id: f.firmId,
      spent_on: '2026-10-03',
      category_id: await categoryId(f.firmId, 'Travel'),
      payee: 'Metro Cabs',
      amount: '12.00',
    })
  })

  const run = (kind: string) =>
    f.manager.db.rpc('transactions_report', { p_firm: f.firmId, p_from: '2026-10-01', p_to: '2026-10-31', p_kind: kind })

  it('includes other income for all and money in, not money out', async () => {
    const all = (await run('all')).data as Row[]
    expect(all.map((r) => [r.kind, r.payee, r.category, r.amount])).toEqual([
      ['other_income', 'First Bank', 'Interest', '3.21'],
      ['expense', 'Metro Cabs', 'Travel', '12.00'],
    ])
    expect(((await run('in')).data as Row[]).map((r) => r.kind)).toEqual(['other_income'])
    expect(((await run('out')).data as Row[]).map((r) => r.kind)).toEqual(['expense'])
  })

  it('refuses another firm', async () => {
    const r = await other.manager.db.rpc('transactions_report', { p_firm: f.firmId, p_from: null, p_to: null, p_kind: 'all' })
    expect(r.error?.code).toBe('42501')
  })
})
