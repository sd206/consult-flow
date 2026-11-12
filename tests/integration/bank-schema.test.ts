import { beforeAll, describe, expect, it } from 'vitest'
import { adminDb, newFirm } from './helpers'
import { issueManualInvoice } from './invoice-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>

const TABLES = ['bank_accounts', 'bank_imports', 'bank_lines', 'other_income', 'other_income_categories']

async function serviceLine(f: Firm, over: Record<string, unknown> = {}) {
  const db = adminDb()
  const acct = await db
    .from('bank_accounts')
    .insert({ firm_id: f.firmId, name: `Acct ${crypto.randomUUID()}`, kind: 'bank' })
    .select('id')
    .single()
  if (acct.error) throw new Error(acct.error.message)
  const imp = await db
    .from('bank_imports')
    .insert({ firm_id: f.firmId, account_id: acct.data.id, file_name: 'x.ofx', format: 'ofx', line_count: 1, duplicate_count: 0 })
    .select('id')
    .single()
  if (imp.error) throw new Error(imp.error.message)
  const line = await db
    .from('bank_lines')
    .insert({
      firm_id: f.firmId,
      account_id: acct.data.id,
      import_id: imp.data.id,
      posted_on: '2026-10-01',
      amount: '100.00',
      description: 'DEPOSIT',
      clean_description: 'DEPOSIT',
      dedupe_key: `k:${crypto.randomUUID()}`,
      ...over,
    })
    .select('id')
    .single()
  if (line.error) throw new Error(line.error.message)
  return { accountId: acct.data.id as string, lineId: line.data.id as string }
}

describe('bank schema', () => {
  let f: Firm
  let other: Firm

  beforeAll(async () => {
    f = await newFirm('Bank Schema Firm')
    other = await newFirm('Bank Schema Other')
    await serviceLine(f)
  })

  it('seeds the four other income categories', async () => {
    const { data } = await f.manager.db
      .from('other_income_categories')
      .select('name')
      .eq('firm_id', f.firmId)
      .order('name')
    expect((data ?? []).map((r) => r.name)).toEqual(['Interest', 'Other', 'Owner contribution', 'Refund'])
  })

  it('hides every table from consultants and other firms', async () => {
    for (const t of TABLES) {
      for (const db of [f.consultant.db, other.manager.db]) {
        const { data } = await db.from(t).select('id').eq('firm_id', f.firmId)
        expect(data ?? [], `${t}`).toHaveLength(0)
      }
    }
  })

  it('lets a manager add, rename and deactivate an account; names are unique ignoring case', async () => {
    const ins = await f.manager.db
      .from('bank_accounts')
      .insert({ firm_id: f.firmId, name: 'Main checking', kind: 'bank', last4: '1234' })
      .select('id')
      .single()
    expect(ins.error).toBeNull()
    const upd = await f.manager.db
      .from('bank_accounts')
      .update({ name: 'Main Checking', active: false })
      .eq('id', ins.data!.id)
      .select('id')
    expect(upd.error).toBeNull()
    expect(upd.data).toHaveLength(1)
    const dup = await f.manager.db.from('bank_accounts').insert({ firm_id: f.firmId, name: ' main checking ', kind: 'credit_card' })
    expect(dup.error?.code).toBe('23505')
    const bad = await f.manager.db.from('bank_accounts').insert({ firm_id: f.firmId, name: 'Card', kind: 'credit_card', last4: '12a4' })
    expect(bad.error).not.toBeNull()
    const cons = await f.consultant.db.from('bank_accounts').insert({ firm_id: f.firmId, name: 'Nope', kind: 'bank' })
    expect(cons.error).not.toBeNull()
  })

  it('refuses direct writes to bank lines from the app', async () => {
    const { accountId } = await serviceLine(f)
    const { error } = await f.manager.db.from('bank_lines').insert({
      firm_id: f.firmId,
      account_id: accountId,
      posted_on: '2026-10-01',
      amount: '5.00',
      description: 'X',
      clean_description: 'X',
      dedupe_key: 'manual',
    })
    expect(error).not.toBeNull()
  })

  it('enforces line status rules and one link per entry', async () => {
    const db = adminDb()
    const zero = await serviceLine(f).catch((e: Error) => e)
    expect(zero).not.toBeInstanceOf(Error)
    const { accountId } = await serviceLine(f)
    const zeroAmount = await db.from('bank_lines').insert({
      firm_id: f.firmId,
      account_id: accountId,
      posted_on: '2026-10-01',
      amount: '0.00',
      description: 'Z',
      clean_description: 'Z',
      dedupe_key: 'zero',
    })
    expect(zeroAmount.error).not.toBeNull()
    const doneWithoutLink = await db.from('bank_lines').insert({
      firm_id: f.firmId,
      account_id: accountId,
      posted_on: '2026-10-01',
      amount: '1.00',
      description: 'D',
      clean_description: 'D',
      dedupe_key: 'done-no-link',
      status: 'done',
    })
    expect(doneWithoutLink.error).not.toBeNull()
    const dupKey = await db.from('bank_lines').insert([
      { firm_id: f.firmId, account_id: accountId, posted_on: '2026-10-01', amount: '1.00', description: 'A', clean_description: 'A', dedupe_key: 'same' },
      { firm_id: f.firmId, account_id: accountId, posted_on: '2026-10-01', amount: '1.00', description: 'A', clean_description: 'A', dedupe_key: 'same' },
    ])
    expect(dupKey.error?.code).toBe('23505')
  })

  it('puts a line back to new when its linked payment is deleted', async () => {
    const db = adminDb()
    const inv = await issueManualInvoice(f, 100)
    const pay = await f.manager.db.rpc('record_payment', {
      p_invoice: inv.invoiceId,
      p_amount: '100.00',
      p_paid_on: '2026-10-01',
      p_method: 'bank_transfer',
      p_reference: null,
      p_notes: null,
    })
    expect(pay.error).toBeNull()
    const { lineId } = await serviceLine(f, { payment_id: pay.data, status: 'done' })
    const second = await serviceLine(f).then(({ lineId: id }) =>
      db.from('bank_lines').update({ payment_id: pay.data, status: 'done' }).eq('id', id),
    )
    expect(second.error?.code).toBe('23505')
    const del = await f.manager.db.rpc('delete_payment', { p_payment: pay.data })
    expect(del.error).toBeNull()
    const { data } = await db.from('bank_lines').select('status, payment_id').eq('id', lineId).single()
    expect(data).toEqual({ status: 'new', payment_id: null })
  })

  it('records other income and refuses a future date', async () => {
    const cat = await f.manager.db
      .from('other_income_categories')
      .select('id')
      .eq('firm_id', f.firmId)
      .eq('name', 'Interest')
      .single()
    const ok = await f.manager.db
      .from('other_income')
      .insert({ firm_id: f.firmId, received_on: '2026-10-01', category_id: cat.data!.id, source: '  First Bank ', amount: '3.21' })
      .select('source')
      .single()
    expect(ok.error).toBeNull()
    expect(ok.data!.source).toBe('First Bank')
    const future = await f.manager.db
      .from('other_income')
      .insert({ firm_id: f.firmId, received_on: '2099-01-01', category_id: cat.data!.id, source: 'Bank', amount: '1.00' })
    expect(future.error?.message).toContain('INCOME_FUTURE')
  })
})
