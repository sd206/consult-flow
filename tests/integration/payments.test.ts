import { beforeAll, describe, expect, it } from 'vitest'
import { validateAttachment } from '@/lib/domain/attachments'
import { deletePayment, listPayments, recordPayment, updatePaymentDetails } from '@/modules/payments/data'
import {
  attachmentDownloadUrl,
  createUploadTargets,
  deleteAttachment,
  finalizeUploads,
} from '@/modules/payments/storage'
import { adminDb, newFirm } from './helpers'
import { issueManualInvoice } from './invoice-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>
type TestFile = { name: string; bytes: Uint8Array }

function must<T>(r: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.data
}

const input = { amount: '400.00', paidOn: '2026-11-02', method: 'bank_transfer' as const, reference: null, notes: null }
const NOT_HERE = "That file doesn't belong here."

function pdf(name = 'a.pdf', extra = 20): TestFile {
  const bytes = new Uint8Array(extra + 5)
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d])
  return { name, bytes }
}
function png(name = 'b.png'): TestFile {
  const bytes = new Uint8Array(30)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return { name, bytes }
}

async function folder(f: Firm, paymentId: string): Promise<string[]> {
  const { data, error } = await adminDb()
    .storage.from('firm-files')
    .list(`firms/${f.firmId}/attachments/payments/${paymentId}`)
  if (error) throw new Error(error.message)
  return (data ?? []).map((o) => o.name)
}

/** The browser flow: ask for targets, upload straight to storage, then finalize. */
async function attach(f: Firm, paymentId: string, files: TestFile[], validate?: Parameters<typeof finalizeUploads>[4]) {
  const declared = files.map((x) => ({ name: x.name, size: x.bytes.length }))
  const t = must(await createUploadTargets(f.manager.db, f.firmId, paymentId, declared))
  expect(t.rejected).toEqual([])
  for (const target of t.targets) {
    const up = await f.manager.db.storage
      .from('firm-files')
      .uploadToSignedUrl(target.uploadPath, target.token, files[target.index].bytes, {
        contentType: 'application/octet-stream',
      })
    expect(up.error).toBeNull()
  }
  const items = t.targets.map((x) => ({ uploadPath: x.uploadPath, name: files[x.index].name }))
  return must(await finalizeUploads(f.manager.db, f.firmId, paymentId, items, validate))
}

async function setup(f: Firm, total = 1000) {
  const { invoiceId } = await issueManualInvoice(f, total)
  const p = must(await recordPayment(f.manager.db, f.firmId, invoiceId, input))
  return { invoiceId, paymentId: p.id }
}

describe('payments data', () => {
  let f: Firm
  beforeAll(async () => {
    f = await newFirm('Pay Firm')
  })

  it('records a payment and lists it', async () => {
    const { invoiceId } = await setup(f)
    const rows = must(await listPayments(f.manager.db, f.firmId, invoiceId))
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe('400.00')
    expect(rows[0].method).toBe('bank_transfer')
    expect(rows[0].attachments).toEqual([])
  })

  it('attaches valid files uploaded straight to storage, with sniffed MIME types', async () => {
    const { invoiceId, paymentId } = await setup(f)
    const r = await attach(f, paymentId, [pdf(), png()])
    expect(r).toEqual({ added: 2, rejected: [] })
    const rows = must(await listPayments(f.manager.db, f.firmId, invoiceId))
    expect(rows[0].attachments.map((a) => a.mimeType).sort()).toEqual(['application/pdf', 'image/png'])
    expect(rows[0].attachments.map((a) => a.sizeBytes).sort()).toEqual([25, 30])
    const names = await folder(f, paymentId)
    expect(names).toHaveLength(2)
    expect(names.some((n) => n.startsWith('incoming-'))).toBe(false)
  })

  it('issues upload targets in the payment folder only', async () => {
    const { paymentId } = await setup(f)
    const t = must(await createUploadTargets(f.manager.db, f.firmId, paymentId, [{ name: 'a.pdf', size: 10 }]))
    expect(t.rejected).toEqual([])
    expect(t.targets).toHaveLength(1)
    expect(t.targets[0].index).toBe(0)
    expect(t.targets[0].uploadPath).toMatch(
      new RegExp(`^firms/${f.firmId}/attachments/payments/${paymentId}/incoming-[0-9a-f-]{36}$`),
    )
    expect(t.targets[0].token).toBeTruthy()
  })

  it('rejects an empty or oversize declared file before issuing a target', async () => {
    const { paymentId } = await setup(f)
    const t = must(
      await createUploadTargets(f.manager.db, f.firmId, paymentId, [
        { name: 'big.pdf', size: 10_485_761 },
        { name: 'ok.pdf', size: 10_485_760 },
        { name: 'empty.pdf', size: 0 },
      ]),
    )
    expect(t.targets.map((x) => x.index)).toEqual([1])
    expect(t.rejected).toEqual([
      { name: 'big.pdf', error: 'Each file must be 10 MB or smaller.' },
      { name: 'empty.pdf', error: 'That file is empty.' },
    ])
  })

  it('refuses more than 5 files', async () => {
    const { paymentId } = await setup(f)
    const files = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.pdf`, size: 25 }))
    expect(await createUploadTargets(f.manager.db, f.firmId, paymentId, files)).toEqual({
      ok: false,
      error: 'Attach up to 5 files at a time.',
    })
    const items = files.map((x, i) => ({
      uploadPath: `firms/${f.firmId}/attachments/payments/${paymentId}/incoming-${i}`,
      name: x.name,
    }))
    expect(await finalizeUploads(f.manager.db, f.firmId, paymentId, items)).toEqual({
      ok: false,
      error: 'Attach up to 5 files at a time.',
    })
  })

  it('refuses targets for another firm payment or a void invoice', async () => {
    const { paymentId } = await setup(f)
    const g = await newFirm('Target Other Firm')
    expect(await createUploadTargets(g.admin.db, g.firmId, paymentId, [{ name: 'a.pdf', size: 5 }])).toEqual({
      ok: false,
      error: 'Payment not found.',
    })
    const { invoiceId, paymentId: p2 } = await setup(f)
    const { error } = await adminDb().from('invoices').update({ status: 'void' }).eq('id', invoiceId)
    expect(error).toBeNull()
    expect(await createUploadTargets(f.manager.db, f.firmId, p2, [{ name: 'a.pdf', size: 5 }])).toEqual({
      ok: false,
      error: "Payments on this invoice can't be changed.",
    })
  })

  it('rejects a disguised file on finalize and removes the upload', async () => {
    const { paymentId } = await setup(f)
    const bytes = new Uint8Array(40)
    bytes.set([0x4d, 0x5a])
    const r = await attach(f, paymentId, [{ name: 'invoice.pdf', bytes }])
    expect(r).toEqual({
      added: 0,
      rejected: [{ name: 'invoice.pdf', error: 'Only PDF, PNG, JPEG or HEIC files can be attached.' }],
    })
    expect(await folder(f, paymentId)).toEqual([])
  })

  it('storage refuses an oversize upload, and finalize reports the file', async () => {
    const { paymentId } = await setup(f)
    // Declares a small size, then sends more than the bucket's 10 MB limit.
    const t = must(await createUploadTargets(f.manager.db, f.firmId, paymentId, [{ name: 'big.pdf', size: 100 }]))
    const [target] = t.targets
    const big = pdf('big.pdf', 10_485_761 - 5)
    const up = await f.manager.db.storage
      .from('firm-files')
      .uploadToSignedUrl(target.uploadPath, target.token, big.bytes, { contentType: 'application/pdf' })
    expect(up.error).not.toBeNull()
    const r = must(
      await finalizeUploads(f.manager.db, f.firmId, paymentId, [{ uploadPath: target.uploadPath, name: 'big.pdf' }]),
    )
    expect(r).toEqual({ added: 0, rejected: [{ name: 'big.pdf', error: "The file couldn't be uploaded." }] })
    expect(await folder(f, paymentId)).toEqual([])
  })

  it('checks the size of the stored bytes on finalize', async () => {
    const { paymentId } = await setup(f)
    let seen = -1
    const spy: Parameters<typeof finalizeUploads>[4] = (file) => {
      seen = file.bytes.length
      return validateAttachment({ ...file, size: 10_485_761 })
    }
    const r = await attach(f, paymentId, [pdf()], spy)
    expect(seen).toBe(25)
    expect(r).toEqual({ added: 0, rejected: [{ name: 'a.pdf', error: 'Each file must be 10 MB or smaller.' }] })
    expect(await folder(f, paymentId)).toEqual([])
  })

  it('refuses a path outside the payment incoming folder and leaves it alone', async () => {
    const { paymentId } = await setup(f)
    const { paymentId: other } = await setup(f)
    await attach(f, other, [pdf()])
    const [kept] = await folder(f, other)
    const base = `firms/${f.firmId}/attachments/payments`
    const items = [
      { uploadPath: `${base}/${other}/${kept}`, name: 'steal.pdf' },
      { uploadPath: `${base}/${paymentId}/incoming-../../${other}/${kept}`, name: 'dots.pdf' },
      { uploadPath: `${base}/${paymentId}/${kept}`, name: 'plain.pdf' },
    ]
    const r = must(await finalizeUploads(f.manager.db, f.firmId, paymentId, items))
    expect(r).toEqual({
      added: 0,
      rejected: [
        { name: 'steal.pdf', error: NOT_HERE },
        { name: 'dots.pdf', error: NOT_HERE },
        { name: 'plain.pdf', error: NOT_HERE },
      ],
    })
    expect(await folder(f, other)).toEqual([kept])
  })

  it('removes the stored object when recording the attachment fails', async () => {
    const { paymentId } = await setup(f)
    // A validator returning a MIME the DB rejects makes add_payment_attachment fail after the move.
    const lying = () => ({ ok: true as const, data: { kind: 'pdf' as const, ext: 'pdf' as const, mime: 'text/plain' } })
    const r = await attach(f, paymentId, [pdf()], lying)
    expect(r.added).toBe(0)
    expect(r.rejected).toHaveLength(1)
    expect(await folder(f, paymentId)).toEqual([])
  })

  it('gives a short-lived download link for an attachment, and refuses another firm', async () => {
    const { invoiceId, paymentId } = await setup(f)
    await attach(f, paymentId, [png()])
    const att = must(await listPayments(f.manager.db, f.firmId, invoiceId))[0].attachments[0]
    const link = must(await attachmentDownloadUrl(f.manager.db, f.firmId, att.id))
    const res = await fetch(link.url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('b.png')
    const body = new Uint8Array(await res.arrayBuffer())
    expect(body.length).toBe(30)
    expect(body[1]).toBe(0x50)

    const g = await newFirm('Other Firm')
    expect((await attachmentDownloadUrl(g.admin.db, g.firmId, att.id)).ok).toBe(false)
    expect((await attachmentDownloadUrl(g.admin.db, f.firmId, att.id)).ok).toBe(false)
  })

  it('deletes a payment, its files and recomputes the invoice', async () => {
    const { invoiceId, paymentId } = await setup(f)
    await attach(f, paymentId, [pdf(), png()])
    expect(await folder(f, paymentId)).toHaveLength(2)
    must(await deletePayment(f.manager.db, f.firmId, paymentId))
    expect(await folder(f, paymentId)).toEqual([])
    const { data } = await adminDb().from('invoices').select('status, amount_paid::text').eq('id', invoiceId).single()
    expect(data).toEqual({ status: 'issued', amount_paid: '0.00' })
    expect(must(await listPayments(f.manager.db, f.firmId, invoiceId))).toEqual([])
  })

  it('deletes a single attachment and its file', async () => {
    const { invoiceId, paymentId } = await setup(f)
    await attach(f, paymentId, [pdf()])
    const att = must(await listPayments(f.manager.db, f.firmId, invoiceId))[0].attachments[0]
    must(await deleteAttachment(f.manager.db, f.firmId, paymentId, att.id))
    expect(await folder(f, paymentId)).toEqual([])
    expect(must(await listPayments(f.manager.db, f.firmId, invoiceId))[0].attachments).toEqual([])
  })

  it('updates details without changing the amount', async () => {
    const { invoiceId, paymentId } = await setup(f)
    must(
      await updatePaymentDetails(f.manager.db, f.firmId, paymentId, {
        paidOn: '2026-11-03',
        method: 'check',
        reference: 'CHK 9',
        notes: null,
      }),
    )
    const row = must(await listPayments(f.manager.db, f.firmId, invoiceId))[0]
    expect(row.method).toBe('check')
    expect(row.paidOn).toBe('2026-11-03')
    expect(row.reference).toBe('CHK 9')
    expect(row.amount).toBe('400.00')
  })

  it('does not record or touch another firm invoice or payment', async () => {
    const g = await newFirm('Firm B')
    const { error } = await adminDb().from('firm_members').insert({ firm_id: g.firmId, user_id: f.manager.id, role: 'manager' })
    expect(error).toBeNull()
    const { invoiceId } = await issueManualInvoice(g, 500)
    const r = await recordPayment(f.manager.db, f.firmId, invoiceId, input)
    expect(r).toEqual({ ok: false, error: 'Invoice not found.' })
    const { count } = await adminDb().from('payments').select('id', { count: 'exact', head: true }).eq('invoice_id', invoiceId)
    expect(count).toBe(0)

    const pay = must(await recordPayment(g.manager.db, g.firmId, invoiceId, input))
    expect(await deletePayment(f.manager.db, f.firmId, pay.id)).toEqual({ ok: false, error: 'Payment not found.' })
    const details = { paidOn: '2026-11-03', method: 'cash' as const, reference: null, notes: null }
    expect(await updatePaymentDetails(f.manager.db, f.firmId, pay.id, details)).toEqual({
      ok: false,
      error: 'Payment not found.',
    })
    expect(await listPayments(f.manager.db, f.firmId, invoiceId)).toEqual({ ok: false, error: 'Invoice not found.' })
    expect(await createUploadTargets(f.manager.db, f.firmId, pay.id, [{ name: 'a.pdf', size: 5 }])).toEqual({
      ok: false,
      error: 'Payment not found.',
    })
    expect(
      await finalizeUploads(f.manager.db, f.firmId, pay.id, [
        { uploadPath: `firms/${f.firmId}/attachments/payments/${pay.id}/incoming-x`, name: 'a.pdf' },
      ]),
    ).toEqual({ ok: false, error: 'Payment not found.' })
  })
})
