import { beforeAll, describe, expect, it } from 'vitest'
import {
  deletePayment,
  listPayments,
  recordPayment,
  updatePaymentDetails,
  type UploadFile,
} from '@/modules/payments/data'
import { attachFiles, deleteAttachment, readAttachment } from '@/modules/payments/storage'
import { adminDb, newFirm } from './helpers'
import { issueManualInvoice } from './invoice-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>

function must<T>(r: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.data
}

const input = { amount: '400.00', paidOn: '2026-11-02', method: 'bank_transfer' as const, reference: null, notes: null }

function pdf(name = 'a.pdf', extra = 20): UploadFile {
  const bytes = new Uint8Array(extra + 5)
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d])
  return { name, type: 'application/pdf', size: bytes.length, bytes }
}
function png(name = 'b.png'): UploadFile {
  const bytes = new Uint8Array(30)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return { name, type: 'image/png', size: bytes.length, bytes }
}

async function folder(f: Firm, paymentId: string): Promise<string[]> {
  const { data, error } = await adminDb()
    .storage.from('firm-files')
    .list(`firms/${f.firmId}/attachments/payments/${paymentId}`)
  if (error) throw new Error(error.message)
  return (data ?? []).map((o) => o.name)
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

  it('attaches valid files with sniffed MIME types', async () => {
    const { invoiceId, paymentId } = await setup(f)
    const r = must(await attachFiles(f.manager.db, f.firmId, paymentId, [pdf(), png()]))
    expect(r.added).toBe(2)
    expect(r.rejected).toEqual([])
    const rows = must(await listPayments(f.manager.db, f.firmId, invoiceId))
    expect(rows[0].attachments.map((a) => a.mimeType).sort()).toEqual(['application/pdf', 'image/png'])
    expect(await folder(f, paymentId)).toHaveLength(2)
  })

  it('rejects a disguised file and uploads nothing', async () => {
    const { paymentId } = await setup(f)
    const bytes = new Uint8Array(40)
    bytes.set([0x4d, 0x5a])
    const evil: UploadFile = { name: 'invoice.pdf', type: 'application/pdf', size: 40, bytes }
    const r = must(await attachFiles(f.manager.db, f.firmId, paymentId, [evil]))
    expect(r.added).toBe(0)
    expect(r.rejected).toEqual([{ name: 'invoice.pdf', error: 'Only PDF, PNG, JPEG or HEIC files can be attached.' }])
    expect(await folder(f, paymentId)).toEqual([])
  })

  it('rejects an oversize file', async () => {
    const { paymentId } = await setup(f)
    const big = pdf('big.pdf', 10_485_761 - 5)
    expect(big.size).toBe(10_485_761)
    const r = must(await attachFiles(f.manager.db, f.firmId, paymentId, [big]))
    expect(r.added).toBe(0)
    expect(r.rejected[0].error).toBe('Each file must be 10 MB or smaller.')
    expect(await folder(f, paymentId)).toEqual([])
  })

  it('refuses more than 5 files before uploading', async () => {
    const { paymentId } = await setup(f)
    const files = Array.from({ length: 6 }, (_, i) => pdf(`f${i}.pdf`))
    const r = await attachFiles(f.manager.db, f.firmId, paymentId, files)
    expect(r).toEqual({ ok: false, error: 'Attach up to 5 files at a time.' })
    expect(await folder(f, paymentId)).toEqual([])
  })

  it('removes the uploaded object when recording the attachment fails', async () => {
    const { paymentId } = await setup(f)
    // A validator returning a MIME the DB rejects makes add_payment_attachment fail after the upload.
    const lying = () => ({ ok: true as const, data: { kind: 'pdf' as const, ext: 'pdf' as const, mime: 'text/plain' } })
    const r = must(await attachFiles(f.manager.db, f.firmId, paymentId, [pdf()], lying))
    expect(r.added).toBe(0)
    expect(r.rejected).toHaveLength(1)
    expect(await folder(f, paymentId)).toEqual([])
  })

  it('reads an attachment, and refuses another firm', async () => {
    const { invoiceId, paymentId } = await setup(f)
    must(await attachFiles(f.manager.db, f.firmId, paymentId, [png()]))
    const att = must(await listPayments(f.manager.db, f.firmId, invoiceId))[0].attachments[0]
    const read = must(await readAttachment(f.manager.db, f.firmId, att.id))
    expect(read.mimeType).toBe('image/png')
    expect(read.fileName).toBe('b.png')
    expect(read.bytes.length).toBe(30)
    expect(read.bytes[1]).toBe(0x50)

    const g = await newFirm('Other Firm')
    expect((await readAttachment(g.admin.db, g.firmId, att.id)).ok).toBe(false)
    expect((await readAttachment(g.admin.db, f.firmId, att.id)).ok).toBe(false)
  })

  it('deletes a payment, its files and recomputes the invoice', async () => {
    const { invoiceId, paymentId } = await setup(f)
    must(await attachFiles(f.manager.db, f.firmId, paymentId, [pdf(), png()]))
    expect(await folder(f, paymentId)).toHaveLength(2)
    must(await deletePayment(f.manager.db, f.firmId, paymentId))
    expect(await folder(f, paymentId)).toEqual([])
    const { data } = await adminDb().from('invoices').select('status, amount_paid::text').eq('id', invoiceId).single()
    expect(data).toEqual({ status: 'issued', amount_paid: '0.00' })
    expect(must(await listPayments(f.manager.db, f.firmId, invoiceId))).toEqual([])
  })

  it('deletes a single attachment and its file', async () => {
    const { invoiceId, paymentId } = await setup(f)
    must(await attachFiles(f.manager.db, f.firmId, paymentId, [pdf()]))
    const att = must(await listPayments(f.manager.db, f.firmId, invoiceId))[0].attachments[0]
    must(await deleteAttachment(f.manager.db, f.firmId, att.id))
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
  })
})
