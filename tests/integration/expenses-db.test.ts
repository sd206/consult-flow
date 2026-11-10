import { beforeAll, describe, expect, it } from 'vitest'
import { adminDb, newFirm } from './helpers'
import { issueManualInvoice } from './invoice-fixtures'
import {
  SPENT_ON,
  categoryId,
  expenseAttachmentPath,
  insertClient,
  insertProject,
} from './expense-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>
type DbErr = { code?: string; message?: string; details?: string } | null

const text = (e: DbErr) => `${e?.message} ${e?.details}`
const FUTURE = '2099-01-01'
const DEFAULTS = ['Contractors', 'Office', 'Other', 'Professional fees', 'Software', 'Travel']

type ExpenseRow = { id: string; client_id: string | null; project_id: string | null; category_id: string }

function insertExpense(f: Firm, over: Record<string, unknown>) {
  return f.manager.db
    .from('expenses')
    .insert({
      firm_id: f.firmId,
      spent_on: SPENT_ON,
      payee: 'Acme Air',
      amount: '10.00',
      ...over,
    })
    .select('id, client_id, project_id, category_id')
    .single()
}

async function insertExpenseOk(f: Firm, over: Record<string, unknown>): Promise<ExpenseRow> {
  const { data, error } = await insertExpense(f, over)
  if (error || !data) throw new Error(`expense insert failed: ${error?.message}`)
  return data as ExpenseRow
}

async function expenseRow(id: string): Promise<ExpenseRow> {
  const { data, error } = await adminDb()
    .from('expenses')
    .select('id, client_id, project_id, category_id')
    .eq('id', id)
    .single()
  if (error || !data) throw new Error(`expense read failed: ${error?.message}`)
  return data as ExpenseRow
}

describe('expenses (database)', () => {
  let f: Firm
  let other: Firm

  beforeAll(async () => {
    ;[f, other] = await Promise.all([newFirm('Expenses Firm'), newFirm('Other Expenses Firm')])
  })

  describe('categories', () => {
    it('seeds the six defaults, all active, for a new firm', async () => {
      const { data, error } = await adminDb()
        .from('expense_categories')
        .select('name, active')
        .eq('firm_id', f.firmId)
        .order('name')
      expect(error).toBeNull()
      expect(data).toEqual(DEFAULTS.map((name) => ({ name, active: true })))
    })

    it('rejects a duplicate name ignoring case and spaces, and trims on save', async () => {
      const dup = await f.manager.db
        .from('expense_categories')
        .insert({ firm_id: f.firmId, name: ' travel ' })
      expect(text(dup.error)).toContain('expense_categories_firm_name_key')

      const { data, error } = await f.manager.db
        .from('expense_categories')
        .insert({ firm_id: f.firmId, name: '  Meals  ' })
        .select('name')
        .single()
      expect(error).toBeNull()
      expect(data).toEqual({ name: 'Meals' })
    })

    it('rejects a blank name', async () => {
      const { error } = await f.manager.db
        .from('expense_categories')
        .insert({ firm_id: f.firmId, name: '   ' })
      expect(text(error)).toContain('expense_categories_name_chk')
    })
  })

  describe('expenses', () => {
    let travel: string
    let software: string

    beforeAll(async () => {
      ;[travel, software] = await Promise.all([categoryId(f.firmId, 'Travel'), categoryId(f.firmId, 'Software')])
    })

    it('a manager creates an expense; the amount reads back exactly', async () => {
      const row = await insertExpenseOk(f, { category_id: software, amount: '123.45', notes: '' })
      const { data } = await f.manager.db
        .from('expenses')
        .select('amount::text, notes, payee')
        .eq('id', row.id)
        .single()
      expect(data).toEqual({ amount: '123.45', notes: null, payee: 'Acme Air' })
    })

    it('trims the payee', async () => {
      const row = await insertExpenseOk(f, { category_id: software, payee: '  Shop  ' })
      const { data } = await adminDb().from('expenses').select('payee').eq('id', row.id).single()
      expect(data).toEqual({ payee: 'Shop' })
    })

    it('rejects a zero amount, a future date and a blank payee', async () => {
      const zero = await insertExpense(f, { category_id: software, amount: '0' })
      expect(text(zero.error)).toContain('expenses_amount_chk')
      const future = await insertExpense(f, { category_id: software, spent_on: FUTURE })
      expect(text(future.error)).toContain('EXPENSE_FUTURE')
      const blank = await insertExpense(f, { category_id: software, payee: '   ' })
      expect(text(blank.error)).toContain('expenses_payee_chk')
      const notes = await insertExpense(f, { category_id: software, notes: 'x'.repeat(1001) })
      expect(text(notes.error)).toContain('expenses_notes_chk')
    })

    it('the project sets the client, overriding the caller', async () => {
      const clientA = await insertClient(f.firmId)
      const clientB = await insertClient(f.firmId)
      const clientC = await insertClient(f.firmId)
      const projectP = await insertProject(f.firmId, clientA)
      const projectQ = await insertProject(f.firmId, clientC)

      const row = await insertExpenseOk(f, { category_id: software, client_id: clientB, project_id: projectP })
      expect(row.client_id).toBe(clientA)

      const toQ = await f.manager.db.from('expenses').update({ project_id: projectQ }).eq('id', row.id)
      expect(toQ.error).toBeNull()
      expect((await expenseRow(row.id)).client_id).toBe(clientC)

      const none = await f.manager.db
        .from('expenses')
        .update({ project_id: null, client_id: clientB })
        .eq('id', row.id)
      expect(none.error).toBeNull()
      const after = await expenseRow(row.id)
      expect(after.project_id).toBeNull()
      expect(after.client_id).toBe(clientB)
    })

    it('moving a project to another client moves its expenses, even with a retired category', async () => {
      const t = await newFirm('Project Move Firm')
      const [tTravel, tOffice] = await Promise.all([categoryId(t.firmId, 'Travel'), categoryId(t.firmId, 'Office')])
      const clientA = await insertClient(t.firmId)
      const clientB = await insertClient(t.firmId)
      const projectP = await insertProject(t.firmId, clientA)
      const e1 = await insertExpenseOk(t, { category_id: tTravel, project_id: projectP, amount: '11.11' })
      const e2 = await insertExpenseOk(t, { category_id: tOffice, project_id: projectP, amount: '22.22' })
      const retire = await t.manager.db.from('expense_categories').update({ active: false }).eq('id', tTravel)
      expect(retire.error).toBeNull()

      const move = await t.manager.db.from('projects').update({ client_id: clientB }).eq('id', projectP)
      expect(move.error).toBeNull()
      expect((await expenseRow(e1.id)).client_id).toBe(clientB)
      expect((await expenseRow(e2.id)).client_id).toBe(clientB)

      const totals = (client: string) =>
        t.manager.db
          .rpc('expense_totals', {
            p_firm: t.firmId,
            p_from: null,
            p_to: null,
            p_category: null,
            p_client: client,
            p_project: null,
            p_missing_receipt: null,
          })
          .single()
      expect((await totals(clientB)).data).toEqual({ total: '33.33', expense_count: 2 })
      expect((await totals(clientA)).data).toEqual({ total: '0.00', expense_count: 0 })
    })

    it('a retired category blocks new use but not other edits; restoring re-enables it', async () => {
      const used = await insertExpenseOk(f, { category_id: travel })
      const other_ = await insertExpenseOk(f, { category_id: software })

      const retire = await f.manager.db.from('expense_categories').update({ active: false }).eq('id', travel)
      expect(retire.error).toBeNull()

      const edit = await f.manager.db.from('expenses').update({ payee: 'Renamed' }).eq('id', used.id)
      expect(edit.error).toBeNull()

      const fresh = await insertExpense(f, { category_id: travel })
      expect(text(fresh.error)).toContain('CATEGORY_RETIRED')

      const change = await f.manager.db.from('expenses').update({ category_id: travel }).eq('id', other_.id)
      expect(text(change.error)).toContain('CATEGORY_RETIRED')

      const restore = await f.manager.db.from('expense_categories').update({ active: true }).eq('id', travel)
      expect(restore.error).toBeNull()
      await insertExpenseOk(f, { category_id: travel })
      const change2 = await f.manager.db.from('expenses').update({ category_id: travel }).eq('id', other_.id)
      expect(change2.error).toBeNull()
    })

    it('a used category cannot be deleted; an unused one can', async () => {
      await insertExpenseOk(f, { category_id: software })
      const del = await f.manager.db.from('expense_categories').delete().eq('id', software)
      expect(text(del.error)).toContain('expenses_category_fk')

      const { data: spare } = await f.manager.db
        .from('expense_categories')
        .insert({ firm_id: f.firmId, name: 'Spare' })
        .select('id')
        .single()
      const delSpare = await f.manager.db
        .from('expense_categories')
        .delete()
        .eq('id', (spare as { id: string }).id)
        .select('id')
      expect(delSpare.error).toBeNull()
      expect(delSpare.data).toHaveLength(1)
    })

    it('a client or project with expenses cannot be deleted', async () => {
      const client = await insertClient(f.firmId)
      const project = await insertProject(f.firmId, client)
      await insertExpenseOk(f, { category_id: software, project_id: project })
      const delP = await f.manager.db.from('projects').delete().eq('id', project)
      expect(text(delP.error)).toContain('expenses_project_fk')
      const client2 = await insertClient(f.firmId)
      await insertExpenseOk(f, { category_id: software, client_id: client2 })
      const delC = await f.manager.db.from('clients').delete().eq('id', client2)
      expect(text(delC.error)).toContain('expenses_client_fk')
    })
  })

  describe('access', () => {
    let expenseId: string
    let catId: string

    beforeAll(async () => {
      catId = await categoryId(f.firmId, 'Office')
      expenseId = (await insertExpenseOk(f, { category_id: catId, payee: 'Access Co' })).id
    })

    it('consultants see nothing and cannot insert into either table', async () => {
      const [ce, cc] = await Promise.all([
        f.consultant.db.from('expenses').select('id').eq('firm_id', f.firmId),
        f.consultant.db.from('expense_categories').select('id').eq('firm_id', f.firmId),
      ])
      expect(ce.data).toEqual([])
      expect(cc.data).toEqual([])

      const insE = await f.consultant.db.from('expenses').insert({
        firm_id: f.firmId,
        spent_on: SPENT_ON,
        payee: 'X',
        amount: '1',
        category_id: catId,
      })
      expect(insE.error).not.toBeNull()
      const insC = await f.consultant.db.from('expense_categories').insert({ firm_id: f.firmId, name: 'Nope' })
      expect(insC.error).not.toBeNull()
    })

    it("another firm's manager cannot see or update this firm's rows", async () => {
      const [se, sc] = await Promise.all([
        other.manager.db.from('expenses').select('id').eq('id', expenseId),
        other.manager.db.from('expense_categories').select('id').eq('id', catId),
      ])
      expect(se.data).toEqual([])
      expect(sc.data).toEqual([])

      const upE = await other.manager.db.from('expenses').update({ payee: 'Hacked' }).eq('id', expenseId).select('id')
      expect(upE.data ?? []).toEqual([])
      const upC = await other.manager.db
        .from('expense_categories')
        .update({ name: 'Hacked' })
        .eq('id', catId)
        .select('id')
      expect(upC.data ?? []).toEqual([])

      const { data } = await adminDb().from('expenses').select('payee').eq('id', expenseId).single()
      expect(data).toEqual({ payee: 'Access Co' })
      const { data: c } = await adminDb().from('expense_categories').select('name').eq('id', catId).single()
      expect(c).toEqual({ name: 'Office' })
    })

    it("an expense cannot point at another firm's project", async () => {
      const otherClient = await insertClient(other.firmId)
      const otherProject = await insertProject(other.firmId, otherClient)
      const { error } = await insertExpense(f, { category_id: catId, project_id: otherProject })
      expect(text(error)).toContain('expenses_project_fk')
    })
  })

  describe('expense_totals', () => {
    let t: Firm
    let travel: string
    let office: string
    let clientA: string
    let clientB: string
    let projectA: string
    let withReceipt: string

    const totals = (u: Firm['manager'], over: Record<string, unknown> = {}) =>
      u.db
        .rpc('expense_totals', {
          p_firm: t.firmId,
          p_from: null,
          p_to: null,
          p_category: null,
          p_client: null,
          p_project: null,
          p_missing_receipt: null,
          ...over,
        })
        .single()

    beforeAll(async () => {
      t = await newFirm('Totals Firm')
      ;[travel, office] = await Promise.all([categoryId(t.firmId, 'Travel'), categoryId(t.firmId, 'Office')])
      clientA = await insertClient(t.firmId)
      clientB = await insertClient(t.firmId)
      projectA = await insertProject(t.firmId, clientA)
      // travel/A/project 100.10 (receipt) | travel/B 20.05 | office/A 3.33 | office/none 0.07
      withReceipt = (await insertExpenseOk(t, { category_id: travel, project_id: projectA, amount: '100.10', spent_on: '2026-09-01' })).id
      await insertExpenseOk(t, { category_id: travel, client_id: clientB, amount: '20.05', spent_on: '2026-09-15' })
      await insertExpenseOk(t, { category_id: office, client_id: clientA, amount: '3.33', spent_on: '2026-10-01' })
      await insertExpenseOk(t, { category_id: office, amount: '0.07', spent_on: '2026-10-20' })
      const { error } = await t.manager.db.rpc('add_expense_attachment', {
        p_expense: withReceipt,
        p_storage_path: expenseAttachmentPath(t.firmId, withReceipt),
        p_file_name: 'receipt.pdf',
        p_mime: 'application/pdf',
        p_size: 1234,
      })
      if (error) throw new Error(`add_expense_attachment failed: ${error.message}`)
    })

    it('totals with each filter and a combination', async () => {
      const cases: [Record<string, unknown>, string, number][] = [
        [{}, '123.55', 4],
        [{ p_from: '2026-09-15' }, '23.45', 3],
        [{ p_to: '2026-09-15' }, '120.15', 2],
        [{ p_category: travel }, '120.15', 2],
        [{ p_client: clientA }, '103.43', 2],
        [{ p_project: projectA }, '100.10', 1],
        [{ p_missing_receipt: true }, '23.45', 3],
        [{ p_missing_receipt: false }, '123.55', 4],
        [{ p_category: office, p_client: clientA, p_from: '2026-09-02', p_missing_receipt: true }, '3.33', 1],
        [{ p_from: '2027-01-01' }, '0.00', 0],
      ]
      for (const [over, total, count] of cases) {
        const { data, error } = await totals(t.manager, over)
        expect(error, JSON.stringify(over)).toBeNull()
        expect(data, JSON.stringify(over)).toEqual({ total, expense_count: count })
      }
    })

    it('consultants and other firms get 42501', async () => {
      const c = await totals(t.consultant)
      expect(c.error?.code).toBe('42501')
      const o = await totals(other.manager)
      expect(o.error?.code).toBe('42501')
    })
  })

  describe('attachments', () => {
    let expenseId: string
    let catId: string

    beforeAll(async () => {
      catId = await categoryId(f.firmId, 'Other')
      expenseId = (await insertExpenseOk(f, { category_id: catId })).id
    })

    const add = (u: Firm['manager'], id: string, path: string) =>
      u.db.rpc('add_expense_attachment', {
        p_expense: id,
        p_storage_path: path,
        p_file_name: 'r'.repeat(200),
        p_mime: 'application/pdf',
        p_size: 1234,
      })

    it('rejects a path outside the expense folder', async () => {
      const otherExpense = (await insertExpenseOk(f, { category_id: catId })).id
      for (const path of [
        expenseAttachmentPath(f.firmId, otherExpense),
        `firms/${other.firmId}/attachments/expenses/${expenseId}/x.pdf`,
        `firms/${f.firmId}/attachments/payments/${expenseId}/x.pdf`,
        `firms/${f.firmId}/attachments/expenses/${expenseId}/`,
        `firms/${f.firmId}/attachments/expenses/${expenseId}/a/b.pdf`,
        `firms/${f.firmId}/attachments/expenses/${expenseId}/..`,
      ]) {
        const { error } = await add(f.manager, expenseId, path)
        expect(text(error), path).toContain('attachments_path_chk')
      }
    })

    it('saves a correct path, truncating the file name to 120 characters', async () => {
      const path = expenseAttachmentPath(f.firmId, expenseId)
      const { data: id, error } = await add(f.manager, expenseId, path)
      expect(error).toBeNull()
      const { data } = await adminDb()
        .from('attachments')
        .select('expense_id, payment_id, storage_path, file_name')
        .eq('id', id as string)
        .single()
      expect(data).toEqual({ expense_id: expenseId, payment_id: null, storage_path: path, file_name: 'r'.repeat(120) })
    })

    it('raises EXPENSE_NOT_FOUND for an unknown expense; consultants and other firms get 42501', async () => {
      const missing = crypto.randomUUID()
      const nf = await add(f.manager, missing, expenseAttachmentPath(f.firmId, missing))
      expect(text(nf.error)).toContain('EXPENSE_NOT_FOUND')
      const c = await add(f.consultant, expenseId, expenseAttachmentPath(f.firmId, expenseId))
      expect(c.error?.code).toBe('42501')
      const o = await add(other.manager, expenseId, expenseAttachmentPath(f.firmId, expenseId))
      expect(o.error?.code).toBe('42501')
    })

    it('delete_attachment removes an expense attachment and returns its path', async () => {
      const path = expenseAttachmentPath(f.firmId, expenseId)
      const { data: id } = await add(f.manager, expenseId, path)
      const denied = await f.consultant.db.rpc('delete_attachment', { p_attachment: id })
      expect(denied.error?.code).toBe('42501')
      const { data, error } = await f.manager.db.rpc('delete_attachment', { p_attachment: id })
      expect(error).toBeNull()
      expect(data).toBe(path)
      const { data: rows } = await adminDb().from('attachments').select('id').eq('id', id as string)
      expect(rows).toEqual([])
    })

    it('an attachment row needs exactly one owner', async () => {
      const none = await adminDb().from('attachments').insert({
        firm_id: f.firmId,
        storage_path: expenseAttachmentPath(f.firmId, expenseId),
        file_name: 'x.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1,
      })
      expect(text(none.error)).toContain('attachments_owner_chk')
    })

    it('an attachment row with both owners is rejected', async () => {
      const { invoiceId } = await issueManualInvoice(f, 50)
      const { data: paymentId, error: pErr } = await f.manager.db.rpc('record_payment', {
        p_invoice: invoiceId,
        p_amount: 10,
        p_paid_on: SPENT_ON,
        p_method: 'cash',
        p_reference: null,
        p_notes: null,
      })
      if (pErr) throw new Error(`record_payment failed: ${pErr.message}`)
      const both = await adminDb().from('attachments').insert({
        firm_id: f.firmId,
        payment_id: paymentId,
        expense_id: expenseId,
        storage_path: expenseAttachmentPath(f.firmId, expenseId),
        file_name: 'x.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1,
      })
      expect(text(both.error)).toContain('attachments_owner_chk')
    })

    it('deleting the expense cascades to its attachment rows, and attachments are audited', async () => {
      const doomed = (await insertExpenseOk(f, { category_id: catId })).id
      const { data: attId } = await add(f.manager, doomed, expenseAttachmentPath(f.firmId, doomed))
      const del = await f.manager.db.from('expenses').delete().eq('id', doomed).select('id')
      expect(del.error).toBeNull()
      expect(del.data).toHaveLength(1)
      const { data: rows } = await adminDb().from('attachments').select('id').eq('expense_id', doomed)
      expect(rows).toEqual([])
      const { data: audit } = await adminDb()
        .from('audit_log')
        .select('action')
        .eq('entity_type', 'attachments')
        .eq('entity_id', attId as string)
        .order('at')
      expect((audit ?? []).map((a) => (a as { action: string }).action)).toEqual(['insert', 'delete'])
    })
  })

  describe('audit', () => {
    it('records expense insert, update and delete', async () => {
      const catId = await categoryId(f.firmId, 'Contractors')
      const row = await insertExpenseOk(f, { category_id: catId })
      await f.manager.db.from('expenses').update({ payee: 'Audited' }).eq('id', row.id)
      await f.manager.db.from('expenses').delete().eq('id', row.id)
      const { data } = await adminDb()
        .from('audit_log')
        .select('action, actor_id')
        .eq('entity_type', 'expenses')
        .eq('entity_id', row.id)
        .order('at')
      expect(data).toEqual([
        { action: 'insert', actor_id: f.manager.id },
        { action: 'update', actor_id: f.manager.id },
        { action: 'delete', actor_id: f.manager.id },
      ])
    })
  })
})
