import { beforeAll, describe, expect, it } from 'vitest'
import {
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
  setCategoryActive,
} from '@/modules/expense-categories/data'
import {
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  updateExpense,
  type ExpenseFilters,
  type ExpenseInput,
} from '@/modules/expenses/data'
import { createUploadTargets, finalizeUploads, ownerFolder } from '@/modules/attachments/storage'
import { adminDb, newFirm } from './helpers'
import { categoryId, insertClient, insertProject } from './expense-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>

const BUCKET = 'firm-files'
const NONE: ExpenseFilters = { from: null, to: null, categoryId: null, clientId: null, projectId: null, missingReceipt: false }

function must<T>(r: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.data
}

function pdfBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(25)
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d])
  return bytes
}

function input(over: Partial<ExpenseInput> & { categoryId: string }): ExpenseInput {
  return { spentOn: '2026-10-15', payee: 'Acme Air', amount: '10.00', clientId: null, projectId: null, notes: null, ...over }
}

async function attachReceipt(f: Firm, expenseId: string) {
  const owner = { kind: 'expense' as const, id: expenseId }
  const t = must(await createUploadTargets(f.manager.db, f.firmId, owner, [{ name: 'r.pdf', size: 25 }]))
  const up = await f.manager.db.storage
    .from(BUCKET)
    .uploadToSignedUrl(t.targets[0].uploadPath, t.targets[0].token, pdfBytes(), { contentType: 'application/pdf' })
  expect(up.error).toBeNull()
  const r = must(await finalizeUploads(f.manager.db, f.firmId, owner, [{ uploadPath: t.targets[0].uploadPath, name: 'r.pdf' }]))
  expect(r.added).toBe(1)
}

describe('expenses data module', () => {
  let f: Firm

  beforeAll(async () => {
    f = await newFirm('Expenses Data Firm')
  })

  it('creates, gets and lists with string totals', async () => {
    const travel = await categoryId(f.firmId, 'Travel')
    const { id } = must(await createExpense(f.manager.db, f.firmId, input({ categoryId: travel, amount: '123.45', notes: 'n' })))
    const d = must(await getExpense(f.manager.db, f.firmId, id))
    expect(d).toMatchObject({ id, amount: '123.45', payee: 'Acme Air', categoryName: 'Travel', notes: 'n', receiptCount: 0, attachments: [] })
    const list = must(await listExpenses(f.manager.db, f.firmId, NONE))
    expect(list).toMatchObject({ total: '123.45', count: 1, pages: 1 })
    expect(list.rows).toHaveLength(1)
    expect(list.rows[0].amount).toBe('123.45')
  })

  it('filters rows and totals consistently', async () => {
    const g = await newFirm('Expenses Filter Firm')
    const [travel, software] = await Promise.all([categoryId(g.firmId, 'Travel'), categoryId(g.firmId, 'Software')])
    const [c1, c2] = [await insertClient(g.firmId), await insertClient(g.firmId)]
    const mk = async (o: Partial<ExpenseInput> & { categoryId: string }) => must(await createExpense(g.manager.db, g.firmId, input(o))).id
    const e1 = await mk({ categoryId: travel, clientId: c1, spentOn: '2026-09-01', amount: '100.10' })
    const e2 = await mk({ categoryId: travel, clientId: c1, spentOn: '2026-10-01', amount: '200.20' })
    const e3 = await mk({ categoryId: travel, clientId: c2, spentOn: '2026-10-01', amount: '300.30' })
    const e4 = await mk({ categoryId: software, clientId: c1, spentOn: '2026-10-01', amount: '400.40' })
    const e5 = await mk({ categoryId: software, clientId: c2, spentOn: '2026-11-01', amount: '500.50' })
    await attachReceipt(g, e1)
    const run = async (o: Partial<ExpenseFilters>) => must(await listExpenses(g.manager.db, g.firmId, { ...NONE, ...o }))
    const ids = (r: { rows: { id: string }[] }) => r.rows.map((x) => x.id).sort()

    let r = await run({ categoryId: travel })
    expect(ids(r)).toEqual([e1, e2, e3].sort())
    expect(r.total).toBe('600.60')
    r = await run({ clientId: c2 })
    expect(ids(r)).toEqual([e3, e5].sort())
    expect(r.total).toBe('800.80')
    r = await run({ from: '2026-10-01', to: '2026-10-31' })
    expect(ids(r)).toEqual([e2, e3, e4].sort())
    expect(r.total).toBe('900.90')
    r = await run({ missingReceipt: true })
    expect(ids(r)).toEqual([e2, e3, e4, e5].sort())
    expect(r.total).toBe('1401.40')
    expect(r.count).toBe(4)
    r = await run({ categoryId: travel, clientId: c1, from: '2026-10-01', to: '2026-10-31', missingReceipt: true })
    expect(ids(r)).toEqual([e2])
    expect(r.total).toBe('200.20')
    expect(r.rows[0].clientName).not.toBeNull()
    r = await run({})
    expect(r.rows.find((x) => x.id === e1)?.receiptCount).toBe(1)
  })

  it('pages 50 at a time with a total over all rows', async () => {
    const g = await newFirm('Expenses Paging Firm')
    const cat = await categoryId(g.firmId, 'Office')
    const rows = Array.from({ length: 55 }, (_, i) => ({
      firm_id: g.firmId,
      category_id: cat,
      spent_on: '2026-10-15',
      payee: `P${i}`,
      amount: '1.00',
    }))
    const ins = await adminDb().from('expenses').insert(rows)
    expect(ins.error).toBeNull()
    const p1 = must(await listExpenses(g.manager.db, g.firmId, NONE, 1))
    const p2 = must(await listExpenses(g.manager.db, g.firmId, NONE, 2))
    expect(p1.pages).toBe(2)
    expect(p1.rows).toHaveLength(50)
    expect(p2.rows).toHaveLength(5)
    expect(p2.total).toBe('55.00')
    expect(p2.count).toBe(55)
    expect(new Set([...p1.rows, ...p2.rows].map((x) => x.id)).size).toBe(55)
  })

  it('an update with another client project stores the project client', async () => {
    const g = await newFirm('Expenses Project Firm')
    const cat = await categoryId(g.firmId, 'Office')
    const [c1, c2] = [await insertClient(g.firmId), await insertClient(g.firmId)]
    const p2 = await insertProject(g.firmId, c2)
    const { id } = must(await createExpense(g.manager.db, g.firmId, input({ categoryId: cat, clientId: c1 })))
    must(await updateExpense(g.manager.db, g.firmId, id, input({ categoryId: cat, clientId: c1, projectId: p2 })))
    const d = must(await getExpense(g.manager.db, g.firmId, id))
    expect(d.clientId).toBe(c2)
    expect(d.projectId).toBe(p2)
  })

  it('deleting an expense removes its receipt object', async () => {
    const g = await newFirm('Expenses Delete Firm')
    const cat = await categoryId(g.firmId, 'Office')
    const { id } = must(await createExpense(g.manager.db, g.firmId, input({ categoryId: cat })))
    await attachReceipt(g, id)
    const folder = ownerFolder(g.firmId, { kind: 'expense', id }).replace(/\/$/, '')
    const before = await adminDb().storage.from(BUCKET).list(folder)
    expect(before.data?.length).toBe(1)
    must(await deleteExpense(g.manager.db, g.firmId, id))
    const after = await adminDb().storage.from(BUCKET).list(folder)
    expect(after.data ?? []).toHaveLength(0)
    expect((await getExpense(g.manager.db, g.firmId, id)).ok).toBe(false)
  })

  it('manages categories', async () => {
    const g = await newFirm('Expenses Category Firm')
    const travel = await categoryId(g.firmId, 'Travel')
    must(await createExpense(g.manager.db, g.firmId, input({ categoryId: travel })))
    const cats = must(await listCategories(g.manager.db, g.firmId))
    expect(cats.map((c) => c.name)).toEqual(['Contractors', 'Office', 'Other', 'Professional fees', 'Software', 'Travel'])
    expect(cats.find((c) => c.name === 'Travel')?.expenseCount).toBe(1)
    expect(cats.find((c) => c.name === 'Office')?.expenseCount).toBe(0)

    const dup = await renameCategory(g.manager.db, g.firmId, travel, ' office ')
    expect(dup).toEqual({ ok: false, error: 'A category with that name already exists.' })

    const meals = must(await createCategory(g.manager.db, g.firmId, 'Meals')).id
    must(await setCategoryActive(g.manager.db, g.firmId, meals, false))
    expect(must(await listCategories(g.manager.db, g.firmId, { activeOnly: true })).some((c) => c.id === meals)).toBe(false)
    const retired = await createExpense(g.manager.db, g.firmId, input({ categoryId: meals }))
    expect(retired).toEqual({ ok: false, error: 'That category is retired. Pick another or restore it.' })

    const used = await deleteCategory(g.manager.db, g.firmId, travel)
    expect(used).toEqual({ ok: false, error: "This category has expenses, so it can't be deleted. Retire it instead." })
    must(await deleteCategory(g.manager.db, g.firmId, meals))
  })

  it('does not return another firm expense', async () => {
    const a = await newFirm('Expenses Firm A')
    const b = await newFirm('Expenses Firm B')
    const { error } = await adminDb().from('firm_members').insert({ firm_id: b.firmId, user_id: a.manager.id, role: 'manager' })
    expect(error).toBeNull()
    const { id } = must(await createExpense(b.manager.db, b.firmId, input({ categoryId: await categoryId(b.firmId, 'Office') })))
    expect(await getExpense(a.manager.db, a.firmId, id)).toEqual({ ok: false, error: 'Expense not found.' })
    expect(await updateExpense(a.manager.db, a.firmId, id, input({ categoryId: await categoryId(a.firmId, 'Office') }))).toEqual({
      ok: false,
      error: 'Expense not found.',
    })
  })
})
