import { beforeAll, describe, expect, it } from 'vitest'
import {
  createUploadTargets,
  deleteAttachment,
  finalizeUploads,
  ownerFolder,
  removeOwnerFolder,
  sweepIncoming,
  type Owner,
} from '@/modules/attachments/storage'
import { deletePayment, recordPayment } from '@/modules/payments/data'
import { generateAndStorePdf } from '@/modules/invoices/pdf/storage'
import { adminDb, newFirm } from './helpers'
import { createManualDraft, issueManualInvoice } from './invoice-fixtures'
import { SPENT_ON, categoryId } from './expense-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>

const BUCKET = 'firm-files'
const HOUR = 60 * 60 * 1000
const input = { amount: '400.00', paidOn: '2026-11-02', method: 'bank_transfer' as const, reference: null, notes: null }

function must<T>(r: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.data
}

function pdfBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(25)
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d])
  return bytes
}
const pdfBlob = () => new Blob([pdfBytes()], { type: 'application/pdf' })

/** Object names in a folder, read with the service role. */
async function names(folder: string): Promise<string[]> {
  const { data, error } = await adminDb().storage.from(BUCKET).list(folder.replace(/\/$/, ''))
  if (error) throw new Error(error.message)
  return (data ?? []).filter((o) => o.id !== null).map((o) => o.name)
}

async function exists(path: string): Promise<boolean> {
  const i = path.lastIndexOf('/')
  return (await names(path.slice(0, i))).includes(path.slice(i + 1))
}

async function newPayment(f: Firm): Promise<string> {
  const { invoiceId } = await issueManualInvoice(f, 1000)
  return must(await recordPayment(f.manager.db, f.firmId, invoiceId, input)).id
}

async function newExpense(f: Firm): Promise<string> {
  const { data, error } = await f.manager.db
    .from('expenses')
    .insert({
      firm_id: f.firmId,
      spent_on: SPENT_ON,
      payee: 'Hardening Air',
      amount: '73.19',
      category_id: await categoryId(f.firmId, 'Travel'),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`expense insert failed: ${error?.message}`)
  return (data as { id: string }).id
}

/** The app flow: targets (user), browser upload to the signed URL, finalize. */
async function attach(f: Firm, owner: Owner, count = 1) {
  const declared = Array.from({ length: count }, (_, i) => ({ name: `r${i}.pdf`, size: 25 }))
  const t = must(await createUploadTargets(f.manager.db, f.firmId, owner, declared))
  expect(t.rejected).toEqual([])
  for (const target of t.targets) {
    const up = await f.manager.db.storage
      .from(BUCKET)
      .uploadToSignedUrl(target.uploadPath, target.token, pdfBytes(), { contentType: 'application/pdf' })
    expect(up.error).toBeNull()
  }
  const items = t.targets.map((x) => ({ uploadPath: x.uploadPath, name: declared[x.index].name }))
  return must(await finalizeUploads(f.manager.db, f.firmId, owner, items))
}

/** A direct manager upload to a holding name in the owner folder. */
async function putIncoming(f: Firm, owner: Owner): Promise<string> {
  const path = `${ownerFolder(f.firmId, owner)}incoming-${crypto.randomUUID()}`
  const up = await f.manager.db.storage.from(BUCKET).upload(path, pdfBlob())
  expect(up.error).toBeNull()
  return path
}

describe('storage hardening', () => {
  let f: Firm
  beforeAll(async () => {
    f = await newFirm('Hardening Firm')
  })

  it('managers may upload only incoming-* objects at owner depth under attachments', async () => {
    const pid = await newPayment(f)
    const base = `firms/${f.firmId}/attachments`
    const okPath = `${base}/payments/${pid}/incoming-${crypto.randomUUID()}`
    expect((await f.manager.db.storage.from(BUCKET).upload(okPath, pdfBlob())).error).toBeNull()
    expect(await exists(okPath)).toBe(true)

    const evil = `${base}/payments/${pid}/evil.pdf`
    expect((await f.manager.db.storage.from(BUCKET).upload(evil, pdfBlob())).error).not.toBeNull()
    expect(await exists(evil)).toBe(false)

    const shallow = `${base}/x.pdf`
    expect((await f.manager.db.storage.from(BUCKET).upload(shallow, pdfBlob())).error).not.toBeNull()
    expect(await exists(shallow)).toBe(false)

    const shallowIncoming = `${base}/payments/incoming-${crypto.randomUUID()}`
    expect((await f.manager.db.storage.from(BUCKET).upload(shallowIncoming, pdfBlob())).error).not.toBeNull()

    const otherKind = `${base}/other/${pid}/incoming-${crypto.randomUUID()}`
    expect((await f.manager.db.storage.from(BUCKET).upload(otherKind, pdfBlob())).error).not.toBeNull()

    const consultant = `${base}/payments/${pid}/incoming-${crypto.randomUUID()}`
    expect((await f.consultant.db.storage.from(BUCKET).upload(consultant, pdfBlob())).error).not.toBeNull()

    // A signed upload target is refused too when the path is not a holding name.
    const signed = await f.manager.db.storage.from(BUCKET).createSignedUploadUrl(`${base}/payments/${pid}/evil2.pdf`)
    expect(signed.error).not.toBeNull()
  })

  it('holding names and owner folders must be uuids', async () => {
    const pid = await newPayment(f)
    const eid = await newExpense(f)
    const base = `firms/${f.firmId}/attachments`
    const storage = f.manager.db.storage.from(BUCKET)

    for (const bad of [
      `${base}/payments/${pid}/incoming-foo`,
      `${base}/expenses/${eid}/incoming-${crypto.randomUUID()}.pdf`,
      `${base}/expenses/${eid}/incoming-${crypto.randomUUID().toUpperCase()}`,
      `${base}/payments/not-a-uuid/incoming-${crypto.randomUUID()}`,
      `${base}/expenses/${eid}x/incoming-${crypto.randomUUID()}`,
    ]) {
      expect((await storage.upload(bad, pdfBlob())).error, bad).not.toBeNull()
      expect(await exists(bad), bad).toBe(false)
    }

    const good = `${base}/expenses/${eid}/incoming-${crypto.randomUUID()}`
    expect((await storage.upload(good, pdfBlob())).error).toBeNull()
    expect(await exists(good)).toBe(true)
  })

  it('other firm folders: managers may insert, consultants may not', async () => {
    const misc = `firms/${f.firmId}/misc/${crypto.randomUUID()}.txt`
    const txt = () => new Blob(['hello'], { type: 'text/plain' })
    expect((await f.manager.db.storage.from(BUCKET).upload(misc, txt())).error).toBeNull()
    expect(await exists(misc)).toBe(true)

    const misc2 = `firms/${f.firmId}/misc/${crypto.randomUUID()}.txt`
    expect((await f.consultant.db.storage.from(BUCKET).upload(misc2, txt())).error).not.toBeNull()
    expect(await exists(misc2)).toBe(false)
    await adminDb().storage.from(BUCKET).remove([misc])
  })

  it.each(['payment', 'expense'] as const)(
    '%s: a holding object cannot be registered directly; the normal flow still works',
    async (kind) => {
      const id = kind === 'payment' ? await newPayment(f) : await newExpense(f)
      const owner: Owner = { kind, id }
      const path = await putIncoming(f, owner)
      const common = { p_storage_path: path, p_file_name: 'r.pdf', p_mime: 'application/pdf', p_size: 25 }
      const { data, error } =
        kind === 'payment'
          ? await f.manager.db.rpc('add_payment_attachment', { p_payment: id, ...common })
          : await f.manager.db.rpc('add_expense_attachment', { p_expense: id, ...common })
      expect(data).toBeNull()
      expect(error?.message).toContain('attachments_path_chk')
      const col = kind === 'payment' ? 'payment_id' : 'expense_id'
      const rows = await adminDb().from('attachments').select('id').eq(col, id)
      expect(rows.data).toEqual([])

      expect(await attach(f, owner)).toEqual({ added: 1, rejected: [] })
      const after = await adminDb().from('attachments').select('storage_path').eq(col, id)
      expect(after.data).toHaveLength(1)
      expect((after.data as { storage_path: string }[])[0].storage_path).toMatch(/\/[0-9a-f-]{36}\.pdf$/)
    },
  )

  it('ownerFolder refuses ids that are not uuids', () => {
    const id = crypto.randomUUID()
    expect(() => ownerFolder('not-a-firm', { kind: 'expense', id })).toThrow()
    expect(() => ownerFolder(f.firmId, { kind: 'payment', id: '../x' })).toThrow()
    expect(() => ownerFolder(f.firmId, { kind: 'expense', id: '' })).toThrow()
    expect(ownerFolder(f.firmId, { kind: 'expense', id })).toBe(`firms/${f.firmId}/attachments/expenses/${id}/`)
  })

  it("deleteAttachment refuses another owner's file and leaves it in place", async () => {
    const pid = await newPayment(f)
    const eid = await newExpense(f)
    const owner: Owner = { kind: 'payment', id: pid }
    await attach(f, owner)
    const { data } = await adminDb().from('attachments').select('id, storage_path').eq('payment_id', pid)
    const att = (data as { id: string; storage_path: string }[])[0]

    expect(await deleteAttachment(f.manager.db, f.firmId, { kind: 'expense', id: eid }, att.id)).toEqual({
      ok: false,
      error: 'File not found.',
    })
    const otherPayment = await newPayment(f)
    expect(await deleteAttachment(f.manager.db, f.firmId, { kind: 'payment', id: otherPayment }, att.id)).toEqual({
      ok: false,
      error: 'File not found.',
    })
    expect(await exists(att.storage_path)).toBe(true)
    const still = await adminDb().from('attachments').select('id').eq('id', att.id)
    expect(still.data).toHaveLength(1)

    must(await deleteAttachment(f.manager.db, f.firmId, owner, att.id))
    expect(await exists(att.storage_path)).toBe(false)
  })

  it('stored attachment files cannot be overwritten, moved or removed by a manager', async () => {
    const pid = await newPayment(f)
    expect(await attach(f, { kind: 'payment', id: pid })).toEqual({ added: 1, rejected: [] })
    const folder = ownerFolder(f.firmId, { kind: 'payment', id: pid })
    const [stored] = await names(folder)
    const path = `${folder}${stored}`
    const storage = f.manager.db.storage.from(BUCKET)

    const over = await storage.upload(path, new Blob([new Uint8Array([1, 2, 3])]), { upsert: true })
    expect(over.error).not.toBeNull()
    const upd = await storage.update(path, new Blob([new Uint8Array([1, 2, 3])]))
    expect(upd.error).not.toBeNull()
    const mv = await storage.move(path, `${folder}incoming-${crypto.randomUUID()}`)
    expect(mv.error).not.toBeNull()
    await storage.remove([path])

    expect(await names(folder)).toEqual([stored])
    const dl = await adminDb().storage.from(BUCKET).download(path)
    expect(dl.error).toBeNull()
    expect((await dl.data!.arrayBuffer()).byteLength).toBe(25)

    // Admins are held to the same rule.
    await f.admin.db.storage.from(BUCKET).remove([path])
    expect(await exists(path)).toBe(true)
  })

  it('incoming objects cannot be removed or moved by a manager either', async () => {
    const pid = await newPayment(f)
    const path = await putIncoming(f, { kind: 'payment', id: pid })
    await f.manager.db.storage.from(BUCKET).remove([path])
    expect(await exists(path)).toBe(true)
    const mv = await f.manager.db.storage.from(BUCKET).move(path, `${ownerFolder(f.firmId, { kind: 'payment', id: pid })}x.pdf`)
    expect(mv.error).not.toBeNull()
    expect(await exists(path)).toBe(true)
  })

  it('invoice PDFs cannot be removed or overwritten by a manager', async () => {
    const { invoiceId } = await issueManualInvoice(f, 1000)
    const { path } = must(await generateAndStorePdf(f.manager.db, f.firmId, invoiceId))
    await f.manager.db.storage.from(BUCKET).remove([path])
    expect(await exists(path)).toBe(true)
    const over = await f.manager.db.storage.from(BUCKET).upload(path, pdfBlob(), { upsert: true })
    expect(over.error).not.toBeNull()
    expect(await exists(path)).toBe(true)
  })

  it('the app still removes files: deleteAttachment, deletePayment and the PDF orphan cleanup', async () => {
    const pid = await newPayment(f)
    const owner: Owner = { kind: 'payment', id: pid }
    await attach(f, owner, 2)
    const folder = ownerFolder(f.firmId, owner)
    expect(await names(folder)).toHaveLength(2)

    const { data: atts } = await adminDb().from('attachments').select('id').eq('payment_id', pid)
    must(await deleteAttachment(f.manager.db, f.firmId, owner, (atts as { id: string }[])[0].id))
    expect(await names(folder)).toHaveLength(1)

    // A stray holding object goes with the payment too.
    await putIncoming(f, owner)
    expect(await names(folder)).toHaveLength(2)
    must(await deletePayment(f.manager.db, f.firmId, pid))
    expect(await names(folder)).toEqual([])

    // set_invoice_pdf refuses a draft, so the uploaded PDF is an orphan the app removes.
    const { invoiceId } = await createManualDraft(f, 1000)
    const r = await generateAndStorePdf(f.manager.db, f.firmId, invoiceId)
    expect(r.ok).toBe(false)
    expect(await names(`firms/${f.firmId}/invoices/${invoiceId}`)).toEqual([])
  })

  it('sweepIncoming removes stale holding objects only', async () => {
    const pid = await newPayment(f)
    const owner: Owner = { kind: 'payment', id: pid }
    await attach(f, owner)
    const folder = ownerFolder(f.firmId, owner)
    const [stored] = await names(folder)
    const stale = await putIncoming(f, owner)

    await sweepIncoming(f.firmId, owner)
    expect(await exists(stale)).toBe(true)
    await sweepIncoming(f.firmId, owner, new Date(Date.now() + 23 * HOUR))
    expect(await exists(stale)).toBe(true)

    await sweepIncoming(f.firmId, owner, new Date(Date.now() + 25 * HOUR))
    expect(await names(folder)).toEqual([stored])
  })

  it('removeOwnerFolder empties the folder', async () => {
    const pid = await newPayment(f)
    const owner: Owner = { kind: 'payment', id: pid }
    await attach(f, owner, 2)
    await putIncoming(f, owner)
    const folder = ownerFolder(f.firmId, owner)
    expect(await names(folder)).toHaveLength(3)
    await removeOwnerFolder(f.firmId, owner)
    expect(await names(folder)).toEqual([])
  })

  it('takes files for an expense', async () => {
    const eid = await newExpense(f)
    const owner: Owner = { kind: 'expense', id: eid }
    expect(ownerFolder(f.firmId, owner)).toBe(`firms/${f.firmId}/attachments/expenses/${eid}/`)
    const t = must(await createUploadTargets(f.manager.db, f.firmId, owner, [{ name: 'r.pdf', size: 25 }]))
    expect(t.targets[0].uploadPath).toMatch(
      new RegExp(`^firms/${f.firmId}/attachments/expenses/${eid}/incoming-[0-9a-f-]{36}$`),
    )

    expect(await attach(f, owner)).toEqual({ added: 1, rejected: [] })
    const { data } = await adminDb()
      .from('attachments')
      .select('expense_id, payment_id, storage_path, mime_type')
      .eq('expense_id', eid)
    const rows = (data ?? []) as { expense_id: string; payment_id: string | null; storage_path: string; mime_type: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ expense_id: eid, payment_id: null, mime_type: 'application/pdf' })
    expect(rows[0].storage_path).toMatch(new RegExp(`^firms/${f.firmId}/attachments/expenses/${eid}/[0-9a-f-]{36}\\.pdf$`))
  })

  it('refuses an expense of another firm, and consultants', async () => {
    const eid = await newExpense(f)
    const g = await newFirm('Hardening Other')
    const owner: Owner = { kind: 'expense', id: eid }
    expect(await createUploadTargets(g.admin.db, g.firmId, owner, [{ name: 'r.pdf', size: 25 }])).toEqual({
      ok: false,
      error: 'Expense not found.',
    })
    expect(await createUploadTargets(f.consultant.db, f.firmId, owner, [{ name: 'r.pdf', size: 25 }])).toEqual({
      ok: false,
      error: 'Expense not found.',
    })
    expect(
      await finalizeUploads(g.admin.db, g.firmId, owner, [
        { uploadPath: `${ownerFolder(g.firmId, owner)}incoming-${crypto.randomUUID()}`, name: 'r.pdf' },
      ]),
    ).toEqual({ ok: false, error: 'Expense not found.' })
  })
})
