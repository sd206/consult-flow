import { beforeAll, describe, expect, it } from 'vitest'
import { formatInvoiceNumber } from '@/lib/domain/invoice-number'
import { adminDb, newFirm } from './helpers'
import { seedApprovedHours } from './invoice-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>
type TemplateRow = { id: string; name: string; base_layout: string; is_default: boolean }

const text = (e: { message?: string; details?: string } | null) => `${e?.message} ${e?.details}`

async function templates(f: Firm): Promise<TemplateRow[]> {
  const { data, error } = await f.admin.db
    .from('invoice_templates')
    .select('id, name, base_layout, is_default')
    .eq('firm_id', f.firmId)
    .order('created_at')
  expect(error).toBeNull()
  return data as TemplateRow[]
}

async function defaultTemplateId(firmId: string): Promise<string> {
  const { data, error } = await adminDb()
    .from('invoice_templates')
    .select('id')
    .eq('firm_id', firmId)
    .eq('is_default', true)
    .single()
  if (error || !data) throw new Error(`no default template: ${error?.message}`)
  return (data as { id: string }).id
}

async function newClient(firmId: string): Promise<string> {
  const { data, error } = await adminDb()
    .from('clients')
    .insert({ firm_id: firmId, name: `Client ${crypto.randomUUID()}` })
    .select('id')
    .single()
  if (error || !data) throw new Error(`client insert failed: ${error?.message}`)
  return (data as { id: string }).id
}

async function insertInvoice(firmId: string, extra: Record<string, unknown> = {}) {
  return adminDb()
    .from('invoices')
    .insert({
      firm_id: firmId,
      client_id: await newClient(firmId),
      template_id: await defaultTemplateId(firmId),
      period_start: '2026-10-01',
      period_end: '2026-10-31',
      issue_date: '2026-11-01',
      due_date: '2026-12-01',
      currency: 'USD',
      ...extra,
    })
    .select('id')
    .single()
}

describe('invoice templates', () => {
  let f: Firm
  let modernId: string
  let standardId: string

  beforeAll(async () => {
    f = await newFirm()
  })

  it('new firm gets a default Standard template', async () => {
    const rows = await templates(f)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Standard', base_layout: 'classic', is_default: true })
    standardId = rows[0].id
  })

  it('admin manages templates; manager reads only', async () => {
    const { data, error } = await f.admin.db
      .from('invoice_templates')
      .insert({ firm_id: f.firmId, name: 'Modern', base_layout: 'modern' })
      .select('id')
      .single()
    expect(error).toBeNull()
    modernId = (data as { id: string }).id

    const { error: mErr } = await f.manager.db
      .from('invoice_templates')
      .insert({ firm_id: f.firmId, name: 'Sneaky' })
    expect(text(mErr)).toMatch(/row-level security/)

    const { data: mRows } = await f.manager.db.from('invoice_templates').select('id').eq('firm_id', f.firmId)
    expect(mRows).toHaveLength(2)
    const { data: cRows } = await f.consultant.db.from('invoice_templates').select('id').eq('firm_id', f.firmId)
    expect(cRows).toHaveLength(0)
  })

  it('one default per firm', async () => {
    const { error } = await f.admin.db.rpc('set_default_template', { p_template: modernId })
    expect(error).toBeNull()
    const rows = await templates(f)
    expect(rows.find((r) => r.id === modernId)?.is_default).toBe(true)
    expect(rows.find((r) => r.id === standardId)?.is_default).toBe(false)

    const { error: mErr } = await f.manager.db.rpc('set_default_template', { p_template: standardId })
    expect(mErr?.code).toBe('42501')
  })

  it("default template can't be deleted", async () => {
    const { error } = await f.admin.db.from('invoice_templates').delete().eq('id', standardId)
    expect(error).toBeNull()
    const { error: dErr } = await f.admin.db.from('invoice_templates').delete().eq('id', modernId)
    expect(text(dErr)).toContain('TEMPLATE_IS_DEFAULT')
    expect((await templates(f)).map((r) => r.id)).toEqual([modernId])
  })

  it('bad accent colour rejected', async () => {
    const { error } = await f.admin.db
      .from('invoice_templates')
      .insert({ firm_id: f.firmId, name: 'Red', options: { accentColor: 'red' } })
    expect(text(error)).toContain('invoice_templates_accent_chk')
    const { error: okErr } = await f.admin.db
      .from('invoice_templates')
      .insert({ firm_id: f.firmId, name: 'Slate', options: { accentColor: '#1F2937' } })
    expect(okErr).toBeNull()
  })
})

describe('invoices and lines', () => {
  let a: Firm
  let b: Firm

  beforeAll(async () => {
    ;[a, b] = await Promise.all([newFirm('Firm A'), newFirm('Firm B')])
  })

  it('invoices and lines are read-only to clients', async () => {
    const { data: inv, error } = await insertInvoice(a.firmId)
    expect(error).toBeNull()
    const invoiceId = (inv as { id: string }).id
    const { error: lErr } = await adminDb().from('invoice_lines').insert({
      firm_id: a.firmId,
      invoice_id: invoiceId,
      kind: 'manual',
      description: 'Setup fee',
      quantity: '1',
      unit_price: '133.33',
      amount: '133.33',
    })
    expect(lErr).toBeNull()

    const { data: mInv } = await a.manager.db.from('invoices').select('id').eq('id', invoiceId)
    expect(mInv).toHaveLength(1)
    const { data: mLines } = await a.manager.db.from('invoice_lines').select('id').eq('invoice_id', invoiceId)
    expect(mLines).toHaveLength(1)

    const { error: insErr } = await a.manager.db.from('invoices').insert({
      firm_id: a.firmId,
      client_id: await newClient(a.firmId),
      template_id: await defaultTemplateId(a.firmId),
      period_start: '2026-10-01',
      period_end: '2026-10-31',
      issue_date: '2026-11-01',
      due_date: '2026-12-01',
      currency: 'USD',
    })
    expect(insErr).not.toBeNull()

    const { data: cInv } = await a.consultant.db.from('invoices').select('id')
    expect(cInv).toHaveLength(0)
    const { data: cLines } = await a.consultant.db.from('invoice_lines').select('id')
    expect(cLines).toHaveLength(0)

    const { data: bInv } = await b.admin.db.from('invoices').select('id').eq('firm_id', a.firmId)
    expect(bInv).toHaveLength(0)
    const { data: bLines } = await b.admin.db.from('invoice_lines').select('id').eq('firm_id', a.firmId)
    expect(bLines).toHaveLength(0)
  })

  it('number format matches TypeScript', async () => {
    const cases: [string, number, string][] = [
      ['SRS-{YYYY}-{SEQ:4}', 42, '2026-11-09'],
      ['INV{YY}{MM}-{SEQ:3}', 7, '2027-01-31'],
      ['{SEQ:2}', 1234, '2026-11-09'],
      ['A/{YYYY}/{SEQ:1}', 5, '2026-03-01'],
    ]
    for (const [pattern, seq, issue] of cases) {
      const { data, error } = await a.manager.db.rpc('format_invoice_number', {
        p_pattern: pattern,
        p_seq: seq,
        p_issue: issue,
      })
      expect(error).toBeNull()
      expect(data).toBe(formatInvoiceNumber(pattern, seq, issue))
    }
  })

  it('invoice number unique per firm', async () => {
    const number = `INV-${crypto.randomUUID().slice(0, 8)}`
    const { error: e1 } = await insertInvoice(a.firmId, { status: 'issued', number })
    expect(e1).toBeNull()
    const { error: e2 } = await insertInvoice(a.firmId, { status: 'issued', number })
    expect(text(e2)).toContain('invoices_firm_number_key')
    const { error: e3 } = await insertInvoice(b.firmId, { status: 'issued', number })
    expect(e3).toBeNull()
  })

  it('time entry FK', async () => {
    const fx = await seedApprovedHours(a, { entries: [{ workDate: '2026-10-05', hours: '8' }] })
    const { error } = await adminDb()
      .from('time_entries')
      .update({ invoice_line_id: crypto.randomUUID() })
      .eq('timesheet_id', fx.timesheetId)
    expect(text(error)).toContain('time_entries_invoice_line_fk')
  })
})
