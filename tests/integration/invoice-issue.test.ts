import { beforeAll, describe, expect, it } from 'vitest'
import { adminDb, newFirm } from './helpers'
import { seedApprovedHours, type ApprovedHoursIds } from './invoice-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>
type Invoice = {
  status: string
  number: string | null
  issued_at: string | null
  issued_by: string | null
  voided_at: string | null
  voided_by: string | null
  bill_to_name: string | null
  bill_to_contact_name: string | null
  bill_to_email: string | null
  bill_to_phone: string | null
  bill_to_address: string | null
  from_name: string | null
  from_address: string | null
  from_contact_name: string | null
  from_contact_email: string | null
  from_contact_phone: string | null
  from_logo_path: string | null
  currency: string
  subtotal: string
  discount_amount: string
  total: string
  pdf_path: string | null
}

const text = (e: { message?: string; details?: string } | null) => `${e?.message} ${e?.details}`

const MON = '2026-10-05'
const TUE = '2026-10-06'
const START = '2026-10-01'
const END = '2026-10-31'
const PATTERN = 'SRS-{YYYY}-{SEQ:4}'

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

async function setNumbering(firmId: string, nextSeq: number) {
  const { error } = await adminDb()
    .from('firms')
    .update({ invoice_number_pattern: PATTERN, invoice_next_seq: nextSeq })
    .eq('id', firmId)
  if (error) throw new Error(`firm update failed: ${error.message}`)
}

async function nextSeq(firmId: string): Promise<number> {
  const { data, error } = await adminDb()
    .from('firms')
    .select('invoice_next_seq')
    .eq('id', firmId)
    .single()
  if (error || !data) throw new Error(`firm read failed: ${error?.message}`)
  return (data as { invoice_next_seq: number }).invoice_next_seq
}

/** Creates a draft (manager) for the client and period, issue date 2026-11-09. */
async function draft(f: Firm, clientId: string): Promise<string> {
  const { data, error } = await f.manager.db.rpc('create_invoice_draft', {
    p_firm: f.firmId,
    p_client: clientId,
    p_start: START,
    p_end: END,
    p_template: await defaultTemplateId(f.firmId),
    p_consultants: null,
  })
  if (error || !data) throw new Error(`create_invoice_draft failed: ${error?.message}`)
  const { error: uErr } = await adminDb()
    .from('invoices')
    .update({ issue_date: '2026-11-09', due_date: '2026-12-09' })
    .eq('id', data as string)
  if (uErr) throw new Error(`invoice date update failed: ${uErr.message}`)
  return data as string
}

async function addManual(f: Firm, invoiceId: string) {
  const { error } = await f.manager.db.rpc('save_manual_line', {
    p_invoice: invoiceId,
    p_line: null,
    p_description: 'Setup fee',
    p_quantity: '1',
    p_unit_price: '250.50',
  })
  if (error) throw new Error(`save_manual_line failed: ${error.message}`)
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

async function invoice(id: string): Promise<Invoice> {
  const { data, error } = await adminDb()
    .from('invoices')
    .select(
      'status, number, issued_at, issued_by, voided_at, voided_by, bill_to_name, bill_to_contact_name, bill_to_email, bill_to_phone, bill_to_address, from_name, from_address, from_contact_name, from_contact_email, from_contact_phone, from_logo_path, currency, subtotal::text, discount_amount::text, total::text, pdf_path',
    )
    .eq('id', id)
    .single()
  if (error || !data) throw new Error(`invoice read failed: ${error?.message}`)
  return data as unknown as Invoice
}

async function entries(timesheetId: string) {
  const { data, error } = await adminDb()
    .from('time_entries')
    .select('id, work_date, hours::text, invoice_line_id')
    .eq('timesheet_id', timesheetId)
    .order('work_date')
  if (error) throw new Error(`entries read failed: ${error.message}`)
  return data as { id: string; work_date: string; hours: string; invoice_line_id: string | null }[]
}

async function lineIds(invoiceId: string, kind: 'time' | 'manual' = 'time'): Promise<string[]> {
  const { data, error } = await adminDb()
    .from('invoice_lines')
    .select('id')
    .eq('invoice_id', invoiceId)
    .eq('kind', kind)
    .order('sort_order')
  if (error) throw new Error(`lines read failed: ${error.message}`)
  return (data as { id: string }[]).map((l) => l.id)
}

/** Firm with numbering SRS-{YYYY}-{SEQ:4} at 41 and one approved week (Mon 7.5h, Tue 8h). */
async function hoursFixture(): Promise<{ f: Firm; ids: ApprovedHoursIds }> {
  const f = await newFirm()
  await setNumbering(f.firmId, 41)
  const ids = await seedApprovedHours(f, {
    entries: [
      { workDate: MON, hours: '7.5' },
      { workDate: TUE, hours: '8' },
    ],
  })
  return { f, ids }
}

function issue(f: Firm, invoiceId: string) {
  return f.manager.db.rpc('issue_invoice', { p_invoice: invoiceId })
}

describe('issue_invoice', () => {
  it('assigns the number, links entries, snapshots parties and advances the sequence', async () => {
    const { f, ids } = await hoursFixture()
    const invoiceId = await draft(f, ids.clientId)

    const { data, error } = await issue(f, invoiceId)
    expect(error).toBeNull()
    expect(data).toBe('SRS-2026-0041')
    expect(await nextSeq(f.firmId)).toBe(42)

    const inv = await invoice(invoiceId)
    expect(inv.status).toBe('issued')
    expect(inv.number).toBe('SRS-2026-0041')
    expect(inv.issued_by).toBe(f.manager.id)
    expect(inv.issued_at).not.toBeNull()
    expect(inv.bill_to_name).toMatch(/^Client /)
    expect(inv.from_name).toBe('Test Firm')
    expect(inv.total).toBe('2066.62') // 15.5h × 133.33

    const [lineId] = await lineIds(invoiceId)
    const es = await entries(ids.timesheetId)
    expect(es).toHaveLength(2)
    expect(es.every((e) => e.invoice_line_id === lineId)).toBe(true)
  })

  it('refuses an invoice with no lines', async () => {
    const f = await newFirm()
    await setNumbering(f.firmId, 41)
    const invoiceId = await draft(f, await newClient(f.firmId))

    const { error } = await issue(f, invoiceId)
    expect(text(error)).toContain('INVOICE_EMPTY')
    expect(await nextSeq(f.firmId)).toBe(41)
    expect((await invoice(invoiceId)).status).toBe('draft')
  })

  it('refuses stale hours, links nothing, and issues after regenerating', async () => {
    const { f, ids } = await hoursFixture()
    const invoiceId = await draft(f, ids.clientId)

    let r = await f.manager.db.rpc('reopen_timesheet', { p_timesheet: ids.timesheetId })
    expect(r.error).toBeNull()
    r = await f.consultant.db.rpc('save_timesheet_week', {
      p_firm: f.firmId,
      p_consultant: ids.consultantId,
      p_week_start: MON,
      p_entries: [
        { projectId: ids.projectId, workDate: MON, hours: '6', note: null },
        { projectId: ids.projectId, workDate: TUE, hours: '8', note: null },
      ],
    })
    expect(r.error).toBeNull()
    r = await f.consultant.db.rpc('submit_timesheet', { p_timesheet: ids.timesheetId })
    expect(r.error).toBeNull()
    r = await f.manager.db.rpc('approve_timesheet', { p_timesheet: ids.timesheetId })
    expect(r.error).toBeNull()

    const { error } = await issue(f, invoiceId)
    expect(text(error)).toContain('INVOICE_STALE')
    expect((await entries(ids.timesheetId)).every((e) => e.invoice_line_id === null)).toBe(true)
    expect(await nextSeq(f.firmId)).toBe(41)
    const inv = await invoice(invoiceId)
    expect(inv.status).toBe('draft')
    expect(inv.number).toBeNull()

    r = await f.manager.db.rpc('regenerate_invoice_lines', {
      p_invoice: invoiceId,
      p_consultants: null,
    })
    expect(r.error).toBeNull()
    const ok = await issue(f, invoiceId)
    expect(ok.error).toBeNull()
    expect(ok.data).toBe('SRS-2026-0041')
    expect((await invoice(invoiceId)).total).toBe('1866.62') // 14h × 133.33
  })

  it('cannot bill the same hours twice', async () => {
    const { f, ids } = await hoursFixture()
    const first = await draft(f, ids.clientId)
    const second = await draft(f, ids.clientId)

    expect((await issue(f, first)).error).toBeNull()
    const { error } = await issue(f, second)
    expect(text(error)).toContain('INVOICE_STALE')
    expect(await nextSeq(f.firmId)).toBe(42)
    expect((await invoice(second)).status).toBe('draft')

    const [firstLine] = await lineIds(first)
    expect((await entries(ids.timesheetId)).every((e) => e.invoice_line_id === firstLine)).toBe(
      true,
    )
  })

  it('numbers concurrent issues uniquely and consecutively', async () => {
    const f = await newFirm()
    await setNumbering(f.firmId, 7)
    const clientId = await newClient(f.firmId)
    const drafts: string[] = []
    for (let i = 0; i < 5; i++) {
      const id = await draft(f, clientId)
      await addManual(f, id)
      drafts.push(id)
    }

    const results = await Promise.all(drafts.map((id) => issue(f, id)))
    for (const r of results) expect(r.error).toBeNull()
    const numbers = results.map((r) => r.data as string)
    expect(new Set(numbers).size).toBe(5)
    const seqs = numbers.map((n) => Number(n.slice(-4))).sort((a, b) => a - b)
    expect(seqs).toEqual([7, 8, 9, 10, 11])
    expect(await nextSeq(f.firmId)).toBe(12)
  })

  it('freezes bill-to and from details at issue', async () => {
    const f = await newFirm()
    const db = adminDb()
    await db
      .from('firms')
      .update({
        address: '1 Firm Way',
        contact_name: 'Fran Firm',
        contact_email: 'fran@firm.test',
        contact_phone: '555-0100',
        currency: 'EUR',
      })
      .eq('id', f.firmId)
    const { data: c } = await db
      .from('clients')
      .insert({
        firm_id: f.firmId,
        name: 'Snapshot Client',
        billing_contact_name: 'Bill Payer',
        billing_email: 'bill@client.test',
        billing_phone: '555-0199',
        billing_address: '9 Client Road',
      })
      .select('id')
      .single()
    const clientId = (c as { id: string }).id
    const invoiceId = await draft(f, clientId)
    await addManual(f, invoiceId)
    expect((await issue(f, invoiceId)).error).toBeNull()

    await db.from('clients').update({ billing_address: '10 Moved Street' }).eq('id', clientId)
    await db.from('firms').update({ name: 'Renamed Firm' }).eq('id', f.firmId)

    const inv = await invoice(invoiceId)
    expect(inv).toMatchObject({
      bill_to_name: 'Snapshot Client',
      bill_to_contact_name: 'Bill Payer',
      bill_to_email: 'bill@client.test',
      bill_to_phone: '555-0199',
      bill_to_address: '9 Client Road',
      from_name: 'Test Firm',
      from_address: '1 Firm Way',
      from_contact_name: 'Fran Firm',
      from_contact_email: 'fran@firm.test',
      from_contact_phone: '555-0100',
      currency: 'EUR',
    })
  })

  it('carries a discount and manual lines through unchanged', async () => {
    const { f, ids } = await hoursFixture()
    const invoiceId = await draft(f, ids.clientId)
    await addManual(f, invoiceId)
    const d = await f.manager.db.rpc('set_invoice_discount', {
      p_invoice: invoiceId,
      p_type: 'amount',
      p_value: '100.01',
      p_label: 'Goodwill',
    })
    expect(d.error).toBeNull()
    const before = await invoice(invoiceId)

    expect((await issue(f, invoiceId)).error).toBeNull()
    const after = await invoice(invoiceId)
    expect(after.subtotal).toBe('2317.12') // 2066.62 + 250.50
    expect(after.discount_amount).toBe('100.01')
    expect(after.total).toBe(before.total)
    expect(await lineIds(invoiceId, 'manual')).toHaveLength(1)
  })
})

describe('issued invoices', () => {
  let f: Firm
  let ids: ApprovedHoursIds
  let invoiceId: string

  beforeAll(async () => {
    ;({ f, ids } = await hoursFixture())
    invoiceId = await draft(f, ids.clientId)
    const { error } = await issue(f, invoiceId)
    if (error) throw new Error(`issue failed: ${error.message}`)
  })

  it('are locked against draft edits', async () => {
    const r1 = await f.manager.db.rpc('save_manual_line', {
      p_invoice: invoiceId,
      p_line: null,
      p_description: 'Late',
      p_quantity: '1',
      p_unit_price: '1',
    })
    expect(text(r1.error)).toContain('INVOICE_STATE')
    const r2 = await f.manager.db.rpc('update_invoice_draft', {
      p_invoice: invoiceId,
      p_subject: 'x',
      p_issue_date: '2026-11-09',
      p_due_date: '2026-12-09',
      p_tax_percent: '0',
      p_template: await defaultTemplateId(f.firmId),
    })
    expect(text(r2.error)).toContain('INVOICE_STATE')
    const r3 = await f.manager.db.rpc('delete_invoice_draft', { p_invoice: invoiceId })
    expect(text(r3.error)).toContain('INVOICE_STATE')
    const r4 = await f.manager.db.rpc('issue_invoice', { p_invoice: invoiceId })
    expect(text(r4.error)).toContain('INVOICE_STATE')
  })

  it('block reopening the invoiced timesheet', async () => {
    const { error } = await f.manager.db.rpc('reopen_timesheet', { p_timesheet: ids.timesheetId })
    expect(text(error)).toContain('TIMESHEET_INVOICED')
  })

  it('cannot be voided while they have payments', async () => {
    const other = await draft(f, await newClient(f.firmId))
    await addManual(f, other)
    expect((await issue(f, other)).error).toBeNull()
    await adminDb().from('invoices').update({ amount_paid: '10' }).eq('id', other)

    const { error } = await f.manager.db.rpc('void_invoice', { p_invoice: other })
    expect(text(error)).toContain('INVOICE_HAS_PAYMENTS')
    expect((await invoice(other)).status).toBe('issued')
  })
})

describe('void_invoice', () => {
  it('unlinks the hours, keeps the number, and lets them be invoiced again', async () => {
    const { f, ids } = await hoursFixture()
    const invoiceId = await draft(f, ids.clientId)
    expect((await issue(f, invoiceId)).data).toBe('SRS-2026-0041')

    const { error } = await f.manager.db.rpc('void_invoice', { p_invoice: invoiceId })
    expect(error).toBeNull()
    const inv = await invoice(invoiceId)
    expect(inv.status).toBe('void')
    expect(inv.number).toBe('SRS-2026-0041')
    expect(inv.voided_by).toBe(f.manager.id)
    expect(inv.voided_at).not.toBeNull()
    expect((await entries(ids.timesheetId)).every((e) => e.invoice_line_id === null)).toBe(true)
    expect(await nextSeq(f.firmId)).toBe(42)

    const again = await draft(f, ids.clientId)
    expect(await lineIds(again)).toHaveLength(1)
    const r = await issue(f, again)
    expect(r.error).toBeNull()
    expect(r.data).toBe('SRS-2026-0042')
    const [line] = await lineIds(again)
    expect((await entries(ids.timesheetId)).every((e) => e.invoice_line_id === line)).toBe(true)

    const twice = await f.manager.db.rpc('void_invoice', { p_invoice: invoiceId })
    expect(text(twice.error)).toContain('INVOICE_STATE')
  })

  it('lets the timesheet be reopened after void', async () => {
    const { f, ids } = await hoursFixture()
    const invoiceId = await draft(f, ids.clientId)
    expect((await issue(f, invoiceId)).error).toBeNull()
    expect((await f.manager.db.rpc('void_invoice', { p_invoice: invoiceId })).error).toBeNull()

    const { error } = await f.manager.db.rpc('reopen_timesheet', { p_timesheet: ids.timesheetId })
    expect(error).toBeNull()
  })

  it('refuses a draft', async () => {
    const f = await newFirm()
    const invoiceId = await draft(f, await newClient(f.firmId))
    const { error } = await f.manager.db.rpc('void_invoice', { p_invoice: invoiceId })
    expect(text(error)).toContain('INVOICE_STATE')
  })

  it('reports a missing invoice', async () => {
    const f = await newFirm()
    const { error } = await f.manager.db.rpc('void_invoice', { p_invoice: crypto.randomUUID() })
    expect(text(error)).toContain('INVOICE_NOT_FOUND')
  })
})

describe('set_invoice_pdf', () => {
  it('saves a path inside the invoice folder of an issued invoice only', async () => {
    const f = await newFirm()
    const clientId = await newClient(f.firmId)
    const draftId = await draft(f, clientId)
    await addManual(f, draftId)

    const onDraft = await f.manager.db.rpc('set_invoice_pdf', {
      p_invoice: draftId,
      p_path: `firms/${f.firmId}/invoices/${draftId}/a.pdf`,
    })
    expect(text(onDraft.error)).toContain('INVOICE_STATE')

    expect((await issue(f, draftId)).error).toBeNull()

    const outside = await f.manager.db.rpc('set_invoice_pdf', {
      p_invoice: draftId,
      p_path: `firms/${f.firmId}/invoices/${crypto.randomUUID()}/a.pdf`,
    })
    expect(text(outside.error)).toContain('invoices_pdf_path_chk')

    const path = `firms/${f.firmId}/invoices/${draftId}/b.pdf`
    const ok = await f.manager.db.rpc('set_invoice_pdf', { p_invoice: draftId, p_path: path })
    expect(ok.error).toBeNull()
    expect((await invoice(draftId)).pdf_path).toBe(path)

    const byConsultant = await f.consultant.db.rpc('set_invoice_pdf', {
      p_invoice: draftId,
      p_path: path,
    })
    expect(byConsultant.error?.code).toBe('42501')
  })
})

describe('issue permissions', () => {
  it('consultants and other firms cannot issue or void', async () => {
    const { f, ids } = await hoursFixture()
    const invoiceId = await draft(f, ids.clientId)
    const other = await newFirm()

    const byConsultant = await f.consultant.db.rpc('issue_invoice', { p_invoice: invoiceId })
    expect(byConsultant.error?.code).toBe('42501')
    const byOtherFirm = await other.manager.db.rpc('issue_invoice', { p_invoice: invoiceId })
    expect(byOtherFirm.error).not.toBeNull()
    const voidByOther = await other.manager.db.rpc('void_invoice', { p_invoice: invoiceId })
    expect(voidByOther.error).not.toBeNull()

    expect(await nextSeq(f.firmId)).toBe(41)
    const inv = await invoice(invoiceId)
    expect(inv.status).toBe('draft')
    expect(inv.number).toBeNull()
    expect((await entries(ids.timesheetId)).every((e) => e.invoice_line_id === null)).toBe(true)
  })
})
