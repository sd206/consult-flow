import { beforeAll, describe, expect, it } from 'vitest'
import { adminDb, newFirm } from './helpers'
import { createManualDraft, issueManualInvoice } from './invoice-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>
type DbErr = { code?: string; message?: string; details?: string } | null

const text = (e: DbErr) => `${e?.message} ${e?.details}`
const PAID_ON = '2026-11-02'
const FUTURE = '2099-01-01'

async function invoiceRow(id: string): Promise<{ status: string; amount_paid: string; total: string }> {
  const { data, error } = await adminDb()
    .from('invoices')
    .select('status, amount_paid::text, total::text')
    .eq('id', id)
    .single()
  if (error || !data) throw new Error(`invoice read failed: ${error?.message}`)
  return data as { status: string; amount_paid: string; total: string }
}

async function paymentCount(invoiceId: string): Promise<number> {
  const { count, error } = await adminDb()
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_id', invoiceId)
  if (error) throw new Error(`payments count failed: ${error.message}`)
  return count ?? 0
}

function record(f: Firm, invoiceId: string, amount: number | string, over: Record<string, unknown> = {}) {
  return f.manager.db.rpc('record_payment', {
    p_invoice: invoiceId,
    p_amount: amount,
    p_paid_on: PAID_ON,
    p_method: 'bank_transfer',
    p_reference: null,
    p_notes: null,
    ...over,
  })
}

async function recordOk(f: Firm, invoiceId: string, amount: number | string): Promise<string> {
  const { data, error } = await record(f, invoiceId, amount)
  if (error || !data) throw new Error(`record_payment failed: ${error?.message}`)
  return data as string
}

function attachmentPath(f: Firm, paymentId: string, name = `${crypto.randomUUID()}.pdf`) {
  return `firms/${f.firmId}/attachments/payments/${paymentId}/${name}`
}

function addAttachment(
  f: Firm,
  paymentId: string,
  over: { p_storage_path?: string; p_file_name?: string; p_mime?: string; p_size?: number } = {},
) {
  return f.manager.db.rpc('add_payment_attachment', {
    p_payment: paymentId,
    p_storage_path: attachmentPath(f, paymentId),
    p_file_name: 'receipt.pdf',
    p_mime: 'application/pdf',
    p_size: 1234,
    ...over,
  })
}

describe('payments (database)', () => {
  let f: Firm
  let other: Firm

  beforeAll(async () => {
    ;[f, other] = await Promise.all([newFirm('Payments Firm'), newFirm('Other Firm')])
  })

  describe('record_payment', () => {
    it('moves the invoice through partly_paid to paid, then refuses more', async () => {
      const { invoiceId } = await issueManualInvoice(f, 1000)

      const first = await record(f, invoiceId, 400, { p_reference: '  REF-1  ', p_notes: '   ' })
      expect(first.error).toBeNull()
      expect(await invoiceRow(invoiceId)).toMatchObject({ amount_paid: '400.00', status: 'partly_paid' })

      const { data: pay } = await adminDb()
        .from('payments')
        .select('amount::text, reference, notes, method, paid_on')
        .eq('id', first.data as string)
        .single()
      expect(pay).toMatchObject({
        amount: '400.00',
        reference: 'REF-1',
        notes: null,
        method: 'bank_transfer',
        paid_on: PAID_ON,
      })

      await recordOk(f, invoiceId, 600)
      expect(await invoiceRow(invoiceId)).toMatchObject({ amount_paid: '1000.00', status: 'paid' })

      const { error } = await record(f, invoiceId, 0.01)
      expect(text(error)).toContain('PAYMENT_NOT_ALLOWED')
      expect(await paymentCount(invoiceId)).toBe(2)
    })

    it('refuses a payment above the balance and inserts nothing', async () => {
      const { invoiceId } = await issueManualInvoice(f, 1000)
      const { error } = await record(f, invoiceId, '1000.01')
      expect(text(error)).toContain('PAYMENT_TOO_LARGE')
      expect(await paymentCount(invoiceId)).toBe(0)
      expect(await invoiceRow(invoiceId)).toMatchObject({ amount_paid: '0.00', status: 'issued' })
    })

    it('serialises concurrent payments: one succeeds, one is too large', async () => {
      const { invoiceId } = await issueManualInvoice(f, 1000)
      const results = await Promise.all([record(f, invoiceId, 600), record(f, invoiceId, 600)])
      const ok = results.filter((r) => r.error === null)
      const failed = results.filter((r) => r.error !== null)
      expect(ok).toHaveLength(1)
      expect(failed).toHaveLength(1)
      expect(text(failed[0].error)).toContain('PAYMENT_TOO_LARGE')
      expect(await invoiceRow(invoiceId)).toMatchObject({ amount_paid: '600.00', status: 'partly_paid' })
      expect(await paymentCount(invoiceId)).toBe(1)
    })

    it('rejects a zero amount', async () => {
      const { invoiceId } = await issueManualInvoice(f, 1000)
      const { error } = await record(f, invoiceId, 0)
      expect(text(error)).toContain('payments_amount_chk')
      expect(await paymentCount(invoiceId)).toBe(0)
    })

    it('rejects a future date', async () => {
      const { invoiceId } = await issueManualInvoice(f, 1000)
      const { error } = await record(f, invoiceId, 100, { p_paid_on: FUTURE })
      expect(text(error)).toContain('PAYMENT_FUTURE')
      expect(await paymentCount(invoiceId)).toBe(0)
    })

    it('rejects draft and void invoices', async () => {
      const { invoiceId: draftId } = await createManualDraft(f, 1000)
      const d = await record(f, draftId, 100)
      expect(text(d.error)).toContain('PAYMENT_NOT_ALLOWED')

      const { invoiceId: voidId } = await issueManualInvoice(f, 1000)
      const { error: vErr } = await f.manager.db.rpc('void_invoice', { p_invoice: voidId })
      expect(vErr).toBeNull()
      const v = await record(f, voidId, 100)
      expect(text(v.error)).toContain('PAYMENT_NOT_ALLOWED')

      expect(await paymentCount(draftId)).toBe(0)
      expect(await paymentCount(voidId)).toBe(0)
    })

    it('raises INVOICE_NOT_FOUND for an unknown invoice', async () => {
      const { error } = await record(f, crypto.randomUUID(), 100)
      expect(text(error)).toContain('INVOICE_NOT_FOUND')
    })
  })

  describe('update_payment_details', () => {
    it('changes date, method, reference and notes but never the amount, also when paid', async () => {
      const { invoiceId } = await issueManualInvoice(f, 1000)
      const paymentId = await recordOk(f, invoiceId, 1000)
      expect((await invoiceRow(invoiceId)).status).toBe('paid')

      const { error } = await f.manager.db.rpc('update_payment_details', {
        p_payment: paymentId,
        p_paid_on: '2026-11-03',
        p_method: 'check',
        p_reference: ' CHK-77 ',
        p_notes: 'Mailed',
      })
      expect(error).toBeNull()

      const { data } = await adminDb()
        .from('payments')
        .select('amount::text, paid_on, method, reference, notes')
        .eq('id', paymentId)
        .single()
      expect(data).toEqual({
        amount: '1000.00',
        paid_on: '2026-11-03',
        method: 'check',
        reference: 'CHK-77',
        notes: 'Mailed',
      })
      expect(await invoiceRow(invoiceId)).toMatchObject({ amount_paid: '1000.00', status: 'paid' })
    })

    it('rejects a future date', async () => {
      const { invoiceId } = await issueManualInvoice(f, 1000)
      const paymentId = await recordOk(f, invoiceId, 100)
      const { error } = await f.manager.db.rpc('update_payment_details', {
        p_payment: paymentId,
        p_paid_on: FUTURE,
        p_method: 'cash',
        p_reference: null,
        p_notes: null,
      })
      expect(text(error)).toContain('PAYMENT_FUTURE')
    })

    it('refuses changes on a void invoice', async () => {
      const { invoiceId } = await issueManualInvoice(f, 1000)
      const paymentId = await recordOk(f, invoiceId, 100)
      const { error: dErr } = await f.manager.db.rpc('delete_payment', { p_payment: paymentId })
      expect(dErr).toBeNull()
      const { error: vErr } = await f.manager.db.rpc('void_invoice', { p_invoice: invoiceId })
      expect(vErr).toBeNull()

      // A payment row left on a void invoice (only possible out of band).
      const { data: legacy, error: iErr } = await adminDb()
        .from('payments')
        .insert({
          firm_id: f.firmId,
          invoice_id: invoiceId,
          amount: '50',
          paid_on: PAID_ON,
          method: 'cash',
        })
        .select('id')
        .single()
      if (iErr || !legacy) throw new Error(`legacy insert failed: ${iErr?.message}`)
      const legacyId = (legacy as { id: string }).id

      const upd = await f.manager.db.rpc('update_payment_details', {
        p_payment: legacyId,
        p_paid_on: PAID_ON,
        p_method: 'card',
        p_reference: null,
        p_notes: null,
      })
      expect(text(upd.error)).toContain('PAYMENT_LOCKED')
      const del = await f.manager.db.rpc('delete_payment', { p_payment: legacyId })
      expect(text(del.error)).toContain('PAYMENT_LOCKED')
      const att = await addAttachment(f, legacyId)
      expect(text(att.error)).toContain('PAYMENT_LOCKED')
      expect(await paymentCount(invoiceId)).toBe(1)
    })

    it('raises PAYMENT_NOT_FOUND for an unknown payment', async () => {
      const { error } = await f.manager.db.rpc('update_payment_details', {
        p_payment: crypto.randomUUID(),
        p_paid_on: PAID_ON,
        p_method: 'card',
        p_reference: null,
        p_notes: null,
      })
      expect(text(error)).toContain('PAYMENT_NOT_FOUND')
    })
  })

  describe('delete_payment', () => {
    it('recomputes the invoice, cascades attachments, returns their paths and audits', async () => {
      const { invoiceId } = await issueManualInvoice(f, 1000)
      const keep = await recordOk(f, invoiceId, 700)
      const gone = await recordOk(f, invoiceId, 300)
      expect((await invoiceRow(invoiceId)).status).toBe('paid')

      const path = attachmentPath(f, gone)
      const { data: attId, error: aErr } = await addAttachment(f, gone, { p_storage_path: path })
      expect(aErr).toBeNull()

      const { data: paths, error } = await f.manager.db.rpc('delete_payment', { p_payment: gone })
      expect(error).toBeNull()
      expect(paths).toEqual([path])

      expect(await invoiceRow(invoiceId)).toMatchObject({ amount_paid: '700.00', status: 'partly_paid' })
      const { data: att } = await adminDb().from('attachments').select('id').eq('id', attId as string)
      expect(att).toEqual([])
      const { data: still } = await adminDb().from('payments').select('id').eq('invoice_id', invoiceId)
      expect(still).toEqual([{ id: keep }])

      const { data: audit } = await adminDb()
        .from('audit_log')
        .select('action, before, actor_id')
        .eq('entity_type', 'payments')
        .eq('entity_id', gone)
        .eq('action', 'delete')
      expect(audit).toHaveLength(1)
      const row = audit![0] as { before: { amount: number }; actor_id: string }
      expect(Number(row.before.amount)).toBe(300)
      expect(row.actor_id).toBe(f.manager.id)
    })

    it('raises PAYMENT_NOT_FOUND for an unknown payment', async () => {
      const { error } = await f.manager.db.rpc('delete_payment', { p_payment: crypto.randomUUID() })
      expect(text(error)).toContain('PAYMENT_NOT_FOUND')
    })
  })

  describe('void interplay', () => {
    it('blocks void while payments exist; allows it once they are deleted', async () => {
      const { invoiceId } = await issueManualInvoice(f, 1000)
      const a = await recordOk(f, invoiceId, 250)
      const b = await recordOk(f, invoiceId, 250)

      const blocked = await f.manager.db.rpc('void_invoice', { p_invoice: invoiceId })
      expect(text(blocked.error)).toContain('INVOICE_HAS_PAYMENTS')

      for (const p of [a, b]) {
        const { error } = await f.manager.db.rpc('delete_payment', { p_payment: p })
        expect(error).toBeNull()
      }
      expect(await invoiceRow(invoiceId)).toMatchObject({ amount_paid: '0.00', status: 'issued' })

      const { error } = await f.manager.db.rpc('void_invoice', { p_invoice: invoiceId })
      expect(error).toBeNull()
      expect((await invoiceRow(invoiceId)).status).toBe('void')
    })
  })

  describe('attachments', () => {
    let paymentId: string

    beforeAll(async () => {
      const { invoiceId } = await issueManualInvoice(f, 1000)
      paymentId = await recordOk(f, invoiceId, 100)
    })

    it('rejects a path outside the payment folder', async () => {
      const otherPayment = crypto.randomUUID()
      for (const p of [
        attachmentPath(f, otherPayment),
        `firms/${other.firmId}/attachments/payments/${paymentId}/x.pdf`,
        `firms/${f.firmId}/invoices/${paymentId}/x.pdf`,
        `firms/${f.firmId}/attachments/payments/${paymentId}/`,
        `firms/${f.firmId}/attachments/payments/${paymentId}/a/b.pdf`,
      ]) {
        const { error } = await addAttachment(f, paymentId, { p_storage_path: p })
        expect(text(error)).toContain('attachments_path_chk')
      }
    })

    it('saves a correct path, truncating the file name to 120 characters', async () => {
      const path = attachmentPath(f, paymentId)
      const { data: id, error } = await addAttachment(f, paymentId, {
        p_storage_path: path,
        p_file_name: 'n'.repeat(200),
        p_mime: 'image/png',
        p_size: 10485760,
      })
      expect(error).toBeNull()
      const { data } = await adminDb()
        .from('attachments')
        .select('firm_id, payment_id, storage_path, file_name, mime_type, size_bytes')
        .eq('id', id as string)
        .single()
      expect(data).toEqual({
        firm_id: f.firmId,
        payment_id: paymentId,
        storage_path: path,
        file_name: 'n'.repeat(120),
        mime_type: 'image/png',
        size_bytes: 10485760,
      })
    })

    it('rejects an oversized file', async () => {
      const { error } = await addAttachment(f, paymentId, { p_size: 10485761 })
      expect(text(error)).toContain('attachments_size_chk')
    })

    it('rejects a disallowed MIME type', async () => {
      const { error } = await addAttachment(f, paymentId, { p_mime: 'application/zip' })
      expect(text(error)).toContain('attachments_mime_chk')
    })

    it('raises PAYMENT_NOT_FOUND for an unknown payment', async () => {
      const id = crypto.randomUUID()
      const { error } = await addAttachment(f, id)
      expect(text(error)).toContain('PAYMENT_NOT_FOUND')
    })

    it('delete_attachment removes the row and returns its path', async () => {
      const path = attachmentPath(f, paymentId)
      const { data: id } = await addAttachment(f, paymentId, { p_storage_path: path })
      const { data, error } = await f.manager.db.rpc('delete_attachment', { p_attachment: id })
      expect(error).toBeNull()
      expect(data).toBe(path)
      const { data: rows } = await adminDb().from('attachments').select('id').eq('id', id as string)
      expect(rows).toEqual([])

      const again = await f.manager.db.rpc('delete_attachment', { p_attachment: id })
      expect(text(again.error)).toContain('ATTACHMENT_NOT_FOUND')
    })
  })

  describe('access', () => {
    let invoiceId: string
    let paymentId: string
    let attachmentId: string

    beforeAll(async () => {
      ;({ invoiceId } = await issueManualInvoice(f, 1000))
      paymentId = await recordOk(f, invoiceId, 100)
      const { data, error } = await addAttachment(f, paymentId)
      if (error || !data) throw new Error(`attachment failed: ${error?.message}`)
      attachmentId = data as string
    })

    const calls = (u: Firm['manager'], ids: { invoiceId: string; paymentId: string; attachmentId: string }, firm: Firm) => [
      u.db.rpc('record_payment', {
        p_invoice: ids.invoiceId,
        p_amount: 1,
        p_paid_on: PAID_ON,
        p_method: 'cash',
        p_reference: null,
        p_notes: null,
      }),
      u.db.rpc('update_payment_details', {
        p_payment: ids.paymentId,
        p_paid_on: '2026-11-04',
        p_method: 'cash',
        p_reference: 'hacked',
        p_notes: null,
      }),
      u.db.rpc('delete_payment', { p_payment: ids.paymentId }),
      u.db.rpc('add_payment_attachment', {
        p_payment: ids.paymentId,
        p_storage_path: attachmentPath(firm, ids.paymentId),
        p_file_name: 'x.pdf',
        p_mime: 'application/pdf',
        p_size: 1,
      }),
      u.db.rpc('delete_attachment', { p_attachment: ids.attachmentId }),
    ]

    async function expectUnchanged() {
      expect(await invoiceRow(invoiceId)).toMatchObject({ amount_paid: '100.00', status: 'partly_paid' })
      const { data: pay } = await adminDb()
        .from('payments')
        .select('paid_on, method, reference')
        .eq('invoice_id', invoiceId)
      expect(pay).toEqual([{ paid_on: PAID_ON, method: 'bank_transfer', reference: null }])
      const { data: att } = await adminDb().from('attachments').select('id').eq('payment_id', paymentId)
      expect(att).toEqual([{ id: attachmentId }])
    }

    it('consultants get 42501 from every function', async () => {
      const results = await Promise.all(calls(f.consultant, { invoiceId, paymentId, attachmentId }, f))
      for (const r of results) expect(r.error?.code).toBe('42501')
      await expectUnchanged()
    })

    it("another firm's manager cannot touch this firm's invoice or payments", async () => {
      const results = await Promise.all(calls(other.manager, { invoiceId, paymentId, attachmentId }, f))
      for (const r of results) expect(r.error).not.toBeNull()
      await expectUnchanged()
    })

    it('consultants see no payments or attachments; managers do', async () => {
      const [cp, ca, mp, ma, op] = await Promise.all([
        f.consultant.db.from('payments').select('id').eq('firm_id', f.firmId),
        f.consultant.db.from('attachments').select('id').eq('firm_id', f.firmId),
        f.manager.db.from('payments').select('id').eq('id', paymentId),
        f.manager.db.from('attachments').select('id').eq('id', attachmentId),
        other.manager.db.from('payments').select('id').eq('id', paymentId),
      ])
      expect(cp.data).toEqual([])
      expect(ca.data).toEqual([])
      expect(mp.data).toEqual([{ id: paymentId }])
      expect(ma.data).toEqual([{ id: attachmentId }])
      expect(op.data).toEqual([])
    })

    it('managers cannot write the tables directly', async () => {
      const ins = await f.manager.db.from('payments').insert({
        firm_id: f.firmId,
        invoice_id: invoiceId,
        amount: '1',
        paid_on: PAID_ON,
        method: 'cash',
      })
      expect(ins.error).not.toBeNull()
      const insA = await f.manager.db.from('attachments').insert({
        firm_id: f.firmId,
        payment_id: paymentId,
        storage_path: attachmentPath(f, paymentId),
        file_name: 'x.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1,
      })
      expect(insA.error).not.toBeNull()
      await f.manager.db.from('payments').update({ amount: '1' }).eq('id', paymentId)
      await f.manager.db.from('payments').delete().eq('id', paymentId)
      await expectUnchanged()
    })

    it('invoice_apply_payments is not callable by clients', async () => {
      const { error } = await f.manager.db.rpc('invoice_apply_payments', { p_invoice: invoiceId })
      expect(error).not.toBeNull()
    })
  })
})
