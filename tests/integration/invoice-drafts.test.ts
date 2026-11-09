import { beforeAll, describe, expect, it } from 'vitest'
import { adminDb, newFirm, type TestUser } from './helpers'
import { seedApprovedHours, type ApprovedHoursIds } from './invoice-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>
type Candidate = {
  consultant_id: string
  consultant_name: string
  project_id: string
  project_name: string
  rate: string
  hours: string
  entry_count: number
}
type Totals = {
  subtotal: string
  discount_type: string
  discount_value: string
  discount_label: string | null
  discount_amount: string
  tax_percent: string
  tax_amount: string
  total: string
}
type Line = {
  id: string
  kind: 'time' | 'manual'
  consultant_id: string | null
  project_id: string | null
  description: string
  quantity: string
  unit_price: string
  amount: string
  sort_order: number
}

const text = (e: { message?: string; details?: string } | null) => `${e?.message} ${e?.details}`

const MON = '2026-10-05'
const TUE = '2026-10-06'
const WED = '2026-10-07'
const FRI = '2026-10-09'
const START = '2026-10-01'
const END = '2026-10-31'

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

async function setFirmTax(firmId: string, tax: string) {
  const { error } = await adminDb().from('firms').update({ default_tax_percent: tax }).eq('id', firmId)
  if (error) throw new Error(`firm update failed: ${error.message}`)
}

async function createDraft(
  f: Firm,
  clientId: string,
  opts: { start?: string; end?: string; consultants?: string[] | null; user?: TestUser } = {},
) {
  return (opts.user ?? f.manager).db.rpc('create_invoice_draft', {
    p_firm: f.firmId,
    p_client: clientId,
    p_start: opts.start ?? START,
    p_end: opts.end ?? END,
    p_template: await defaultTemplateId(f.firmId),
    p_consultants: opts.consultants ?? null,
  })
}

async function mustCreateDraft(f: Firm, clientId: string, opts: Parameters<typeof createDraft>[2] = {}) {
  const { data, error } = await createDraft(f, clientId, opts)
  expect(error).toBeNull()
  return data as string
}

async function totals(invoiceId: string): Promise<Totals> {
  const { data, error } = await adminDb()
    .from('invoices')
    .select(
      'subtotal::text, discount_type, discount_value::text, discount_label, discount_amount::text, tax_percent::text, tax_amount::text, total::text',
    )
    .eq('id', invoiceId)
    .single()
  if (error || !data) throw new Error(`invoice read failed: ${error?.message}`)
  return data as unknown as Totals
}

async function lines(invoiceId: string): Promise<Line[]> {
  const { data, error } = await adminDb()
    .from('invoice_lines')
    .select(
      'id, kind, consultant_id, project_id, description, quantity::text, unit_price::text, amount::text, sort_order',
    )
    .eq('invoice_id', invoiceId)
    .order('sort_order')
  if (error) throw new Error(`lines read failed: ${error.message}`)
  return data as unknown as Line[]
}

function saveManual(
  user: TestUser,
  invoiceId: string,
  lineId: string | null,
  description: string,
  quantity: string,
  unitPrice: string,
) {
  return user.db.rpc('save_manual_line', {
    p_invoice: invoiceId,
    p_line: lineId,
    p_description: description,
    p_quantity: quantity,
    p_unit_price: unitPrice,
  })
}

/** One approved entry of 7.33h at 133.33 with 8.25% firm tax → subtotal 977.31. */
async function roundingDraft(): Promise<{ f: Firm; ids: ApprovedHoursIds; invoiceId: string }> {
  const f = await newFirm()
  const ids = await seedApprovedHours(f, { entries: [{ workDate: MON, hours: '7.33' }] })
  await setFirmTax(f.firmId, '8.25')
  const invoiceId = await mustCreateDraft(f, ids.clientId)
  return { f, ids, invoiceId }
}

describe('invoice_candidates', () => {
  let f: Firm
  let ids: ApprovedHoursIds

  beforeAll(async () => {
    f = await newFirm()
    ids = await seedApprovedHours(f, {
      projectName: 'Rollout',
      entries: [
        { workDate: MON, hours: '8', note: 'Discovery' },
        { workDate: TUE, hours: '7.5', note: 'Workshop' },
        { workDate: FRI, hours: '2', note: 'Outside' },
      ],
    })
    // Submitted but not approved, same client and period.
    await seedApprovedHours(f, {
      clientId: ids.clientId,
      projectId: ids.projectId,
      consultantName: 'Pending Person',
      linkUser: false,
      approve: false,
      entries: [{ workDate: MON, hours: '4' }],
    })
    // Another client's approved hours.
    await seedApprovedHours(f, {
      consultantName: 'Other Client Person',
      linkUser: false,
      entries: [{ workDate: MON, hours: '6' }],
    })
  })

  it('groups approved, uninvoiced hours in the period for the client', async () => {
    const { data, error } = await f.manager.db.rpc('invoice_candidates', {
      p_firm: f.firmId,
      p_client: ids.clientId,
      p_start: MON,
      p_end: '2026-10-08',
    })
    expect(error).toBeNull()
    const rows = data as Candidate[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      consultant_id: ids.consultantId,
      consultant_name: 'Con Sultant',
      project_id: ids.projectId,
      project_name: 'Rollout',
      rate: '133.33',
      hours: '15.50',
      entry_count: 2,
    })
  })

  it('consultants cannot list candidates', async () => {
    const { error } = await f.consultant.db.rpc('invoice_candidates', {
      p_firm: f.firmId,
      p_client: ids.clientId,
      p_start: MON,
      p_end: '2026-10-08',
    })
    expect(error?.code).toBe('42501')
  })
})

describe('create_invoice_draft', () => {
  it('rate change mid-period gives two lines', async () => {
    const f = await newFirm()
    const ids = await seedApprovedHours(f, {
      entries: [
        { workDate: MON, hours: '8' },
        { workDate: TUE, hours: '7' },
        { workDate: WED, hours: '6' },
      ],
      beforeApprove: async ({ assignmentId }) => {
        const { error } = await f.manager.db.rpc('change_client_rate', {
          p_assignment: assignmentId,
          p_rate: '150.50',
          p_from: WED,
        })
        if (error) throw new Error(`change_client_rate failed: ${error.message}`)
      },
    })
    const invoiceId = await mustCreateDraft(f, ids.clientId)
    const ls = await lines(invoiceId)
    expect(ls.map((l) => [l.kind, l.unit_price, l.quantity, l.amount, l.sort_order])).toEqual([
      ['time', '133.33', '15.00', '1999.95', 1],
      ['time', '150.50', '6.00', '903.00', 2],
    ])
    expect((await totals(invoiceId)).subtotal).toBe('2902.95')
  })

  it('line description comes from notes, else the project name', async () => {
    const f = await newFirm()
    const withNotes = await seedApprovedHours(f, {
      entries: [
        { workDate: MON, hours: '8', note: 'Discovery' },
        { workDate: TUE, hours: '7.5', note: 'Workshop' },
        { workDate: WED, hours: '1', note: 'Discovery' },
      ],
    })
    const a = await mustCreateDraft(f, withNotes.clientId)
    expect((await lines(a)).map((l) => l.description)).toEqual(['Discovery; Workshop'])

    const noNotes = await seedApprovedHours(f, {
      projectName: 'Quiet Project',
      consultantName: 'Nora Notes',
      linkUser: false,
      entries: [{ workDate: MON, hours: '3' }],
    })
    const b = await mustCreateDraft(f, noNotes.clientId)
    expect((await lines(b)).map((l) => l.description)).toEqual(['Quiet Project'])
  })

  it('uses firm currency, tax and payment terms; zero-line drafts are allowed', async () => {
    const f = await newFirm()
    const ids = await seedApprovedHours(f, { entries: [{ workDate: MON, hours: '1' }] })
    await adminDb()
      .from('firms')
      .update({ currency: 'EUR', default_tax_percent: '7.5', default_payment_terms_days: 14 })
      .eq('id', f.firmId)
    const invoiceId = await mustCreateDraft(f, ids.clientId, { consultants: [] })
    const { data } = await adminDb()
      .from('invoices')
      .select('status, currency, tax_percent::text, issue_date, due_date, subtotal::text')
      .eq('id', invoiceId)
      .single()
    expect(data).toMatchObject({ status: 'draft', currency: 'EUR', tax_percent: '7.50', subtotal: '0.00' })
    const row = data as { issue_date: string; due_date: string }
    expect(Date.parse(row.due_date) - Date.parse(row.issue_date)).toBe(14 * 86_400_000)
    expect(await lines(invoiceId)).toHaveLength(0)
  })

  it('rounding (Review Focus 4)', async () => {
    const { invoiceId } = await roundingDraft()
    const ls = await lines(invoiceId)
    expect(ls).toHaveLength(1)
    expect(ls[0].amount).toBe('977.31')
    expect(await totals(invoiceId)).toMatchObject({
      subtotal: '977.31',
      discount_amount: '0.00',
      tax_percent: '8.25',
      tax_amount: '80.63',
      total: '1057.94',
    })
  })

  it('drafts never link time entries', async () => {
    const { ids } = await roundingDraft()
    const { data } = await adminDb()
      .from('time_entries')
      .select('invoice_line_id')
      .eq('timesheet_id', ids.timesheetId)
    expect((data as { invoice_line_id: string | null }[]).every((e) => e.invoice_line_id === null)).toBe(
      true,
    )
  })
})

describe('discounts', () => {
  it('percentage discount', async () => {
    const { f, invoiceId } = await roundingDraft()
    const { error } = await f.manager.db.rpc('set_invoice_discount', {
      p_invoice: invoiceId,
      p_type: 'percent',
      p_value: 10,
      p_label: '  Loyalty  ',
    })
    expect(error).toBeNull()
    expect(await totals(invoiceId)).toMatchObject({
      discount_type: 'percent',
      discount_value: '10.00',
      discount_label: 'Loyalty',
      discount_amount: '97.73',
      tax_amount: '72.57',
      total: '952.15',
    })
  })

  it('fixed discount, then none', async () => {
    const { f, invoiceId } = await roundingDraft()
    let r = await f.manager.db.rpc('set_invoice_discount', {
      p_invoice: invoiceId,
      p_type: 'amount',
      p_value: 100,
      p_label: null,
    })
    expect(r.error).toBeNull()
    expect(await totals(invoiceId)).toMatchObject({
      discount_amount: '100.00',
      tax_amount: '72.38',
      total: '949.69',
    })
    r = await f.manager.db.rpc('set_invoice_discount', {
      p_invoice: invoiceId,
      p_type: 'none',
      p_value: 25,
      p_label: 'Ignored',
    })
    expect(r.error).toBeNull()
    expect(await totals(invoiceId)).toMatchObject({
      discount_type: 'none',
      discount_value: '0.00',
      discount_label: null,
      discount_amount: '0.00',
      total: '1057.94',
    })
  })

  it('discount too large (Review Focus 5)', async () => {
    const { f, invoiceId } = await roundingDraft()
    const set = (type: string, value: number) =>
      f.manager.db.rpc('set_invoice_discount', {
        p_invoice: invoiceId,
        p_type: type,
        p_value: value,
        p_label: null,
      })
    let r = await set('amount', 1000)
    expect(text(r.error)).toContain('DISCOUNT_TOO_LARGE')
    expect((await totals(invoiceId)).discount_amount).toBe('0.00')

    r = await set('amount', 900)
    expect(r.error).toBeNull()
    expect((await totals(invoiceId)).discount_amount).toBe('900.00')

    r = await f.manager.db.rpc('regenerate_invoice_lines', { p_invoice: invoiceId, p_consultants: [] })
    expect(r.error).toBeNull()
    expect(await totals(invoiceId)).toMatchObject({
      subtotal: '0.00',
      discount_type: 'amount',
      discount_value: '900.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      total: '0.00',
    })

    r = await set('percent', 101)
    expect(text(r.error)).toContain('invoices_discount_chk')
  })

  it('long labels are cut to 60 characters; blank labels become null', async () => {
    const { f, invoiceId } = await roundingDraft()
    await f.manager.db.rpc('set_invoice_discount', {
      p_invoice: invoiceId,
      p_type: 'percent',
      p_value: 5,
      p_label: 'x'.repeat(80),
    })
    expect((await totals(invoiceId)).discount_label).toBe('x'.repeat(60))
    await f.manager.db.rpc('set_invoice_discount', {
      p_invoice: invoiceId,
      p_type: 'percent',
      p_value: 5,
      p_label: '   ',
    })
    expect((await totals(invoiceId)).discount_label).toBeNull()
  })
})

describe('lines', () => {
  it('deselecting a consultant keeps manual lines after time lines', async () => {
    const f = await newFirm()
    const c1 = await seedApprovedHours(f, {
      consultantName: 'Alice Able',
      entries: [{ workDate: MON, hours: '5' }],
    })
    const c2 = await seedApprovedHours(f, {
      clientId: c1.clientId,
      projectId: c1.projectId,
      consultantName: 'Bob Baker',
      clientRate: '120',
      linkUser: false,
      entries: [{ workDate: MON, hours: '3' }],
    })
    const invoiceId = await mustCreateDraft(f, c1.clientId)
    let ls = await lines(invoiceId)
    expect(ls.map((l) => l.consultant_id)).toEqual([c1.consultantId, c2.consultantId])

    const m = await saveManual(f.manager, invoiceId, null, 'Setup fee', '1', '500')
    expect(m.error).toBeNull()
    const m2 = await saveManual(f.manager, invoiceId, null, 'Travel', '1', '50')
    expect(m2.error).toBeNull()
    ls = await lines(invoiceId)
    expect(ls.map((l) => [l.kind, l.sort_order])).toEqual([
      ['time', 1],
      ['time', 2],
      ['manual', 3],
      ['manual', 4],
    ])

    const r = await f.manager.db.rpc('regenerate_invoice_lines', {
      p_invoice: invoiceId,
      p_consultants: [c1.consultantId],
    })
    expect(r.error).toBeNull()
    ls = await lines(invoiceId)
    expect(ls.map((l) => [l.kind, l.consultant_id, l.description, l.sort_order])).toEqual([
      ['time', c1.consultantId, 'Rollout', 1],
      ['manual', null, 'Setup fee', 2],
      ['manual', null, 'Travel', 3],
    ])
    expect((await totals(invoiceId)).subtotal).toBe('1216.65')
  })

  it('manual lines', async () => {
    const { f, invoiceId } = await roundingDraft()
    let r = await saveManual(f.manager, invoiceId, null, '  Setup fee ', '1', '500')
    expect(r.error).toBeNull()
    const manualId = r.data as string
    expect(await totals(invoiceId)).toMatchObject({ subtotal: '1477.31', total: '1599.19' })
    const manual = (await lines(invoiceId)).find((l) => l.id === manualId)
    expect(manual).toMatchObject({ kind: 'manual', description: 'Setup fee', amount: '500.00' })

    r = await saveManual(f.manager, invoiceId, manualId, 'Setup fee', '2', '500')
    expect(r.error).toBeNull()
    expect(r.data).toBe(manualId)
    expect((await lines(invoiceId)).find((l) => l.id === manualId)?.amount).toBe('1000.00')
    expect((await totals(invoiceId)).subtotal).toBe('1977.31')

    const timeLine = (await lines(invoiceId)).find((l) => l.kind === 'time')!
    r = await saveManual(f.manager, invoiceId, timeLine.id, 'Hack', '1', '1')
    expect(text(r.error)).toContain('LINE_NOT_MANUAL')
    r = await f.manager.db.rpc('delete_manual_line', { p_line: timeLine.id })
    expect(text(r.error)).toContain('LINE_NOT_MANUAL')

    r = await saveManual(f.manager, invoiceId, null, 'Zero', '0', '10')
    expect(text(r.error)).toContain('invoice_lines_quantity_chk')
    r = await saveManual(f.manager, invoiceId, null, '   ', '1', '10')
    expect(text(r.error)).toContain('invoice_lines_description_chk')

    r = await f.manager.db.rpc('delete_manual_line', { p_line: manualId })
    expect(r.error).toBeNull()
    expect(await totals(invoiceId)).toMatchObject({ subtotal: '977.31', total: '1057.94' })
  })

  it('a manual line must belong to the invoice', async () => {
    const { f, invoiceId } = await roundingDraft()
    const other = await mustCreateDraft(f, (await seedApprovedHours(f, {
      consultantName: 'Other',
      linkUser: false,
      entries: [{ workDate: MON, hours: '1' }],
    })).clientId)
    const { data: lineId } = await saveManual(f.manager, other, null, 'Theirs', '1', '1')
    const r = await saveManual(f.manager, invoiceId, lineId as string, 'Mine', '1', '1')
    expect(r.error).not.toBeNull()
    expect((await lines(other)).find((l) => l.id === lineId)?.description).toBe('Theirs')
  })

  it('set_invoice_line_description works on any line kind', async () => {
    const { f, invoiceId } = await roundingDraft()
    const timeLine = (await lines(invoiceId))[0]
    let r = await f.manager.db.rpc('set_invoice_line_description', {
      p_line: timeLine.id,
      p_description: ' Consulting, October ',
    })
    expect(r.error).toBeNull()
    expect((await lines(invoiceId))[0].description).toBe('Consulting, October')
    r = await f.manager.db.rpc('set_invoice_line_description', { p_line: timeLine.id, p_description: '' })
    expect(text(r.error)).toContain('invoice_lines_description_chk')
  })
})

describe('header and period', () => {
  it('header edits', async () => {
    const { f, invoiceId } = await roundingDraft()
    const tpl = await defaultTemplateId(f.firmId)
    const update = (issue: string, due: string, tax: number) =>
      f.manager.db.rpc('update_invoice_draft', {
        p_invoice: invoiceId,
        p_subject: 'October work',
        p_issue_date: issue,
        p_due_date: due,
        p_tax_percent: tax,
        p_template: tpl,
      })
    let r = await update('2026-11-10', '2026-11-01', 8.25)
    expect(text(r.error)).toContain('invoices_due_chk')
    r = await update('2026-11-10', '2026-12-10', 101)
    expect(text(r.error)).toContain('invoices_tax_chk')
    r = await update('2026-11-10', '2026-12-10', 10)
    expect(r.error).toBeNull()
    expect(await totals(invoiceId)).toMatchObject({
      tax_percent: '10.00',
      tax_amount: '97.73',
      total: '1075.04',
    })
    const { data } = await adminDb()
      .from('invoices')
      .select('subject, issue_date, due_date')
      .eq('id', invoiceId)
      .single()
    expect(data).toEqual({ subject: 'October work', issue_date: '2026-11-10', due_date: '2026-12-10' })
  })

  it('period change regenerates', async () => {
    const f = await newFirm()
    const ids = await seedApprovedHours(f, {
      entries: [
        { workDate: MON, hours: '8', note: 'Discovery' },
        { workDate: TUE, hours: '7.5', note: 'Workshop' },
      ],
    })
    const invoiceId = await mustCreateDraft(f, ids.clientId)
    expect((await lines(invoiceId))[0].quantity).toBe('15.50')
    const r = await f.manager.db.rpc('update_invoice_period', {
      p_invoice: invoiceId,
      p_start: START,
      p_end: MON,
      p_consultants: null,
    })
    expect(r.error).toBeNull()
    const ls = await lines(invoiceId)
    expect(ls).toHaveLength(1)
    expect(ls[0]).toMatchObject({ quantity: '8.00', description: 'Discovery', amount: '1066.64' })
    const { data } = await adminDb()
      .from('invoices')
      .select('period_start, period_end, subtotal::text')
      .eq('id', invoiceId)
      .single()
    expect(data).toEqual({ period_start: START, period_end: MON, subtotal: '1066.64' })
  })
})

describe('consultant filter', () => {
  async function filterOf(invoiceId: string): Promise<string[] | null> {
    const { data, error } = await adminDb().from('invoices').select('consultant_filter').eq('id', invoiceId).single()
    if (error || !data) throw new Error(`invoice read failed: ${error?.message}`)
    return (data as { consultant_filter: string[] | null }).consultant_filter
  }

  it('the draft remembers an empty selection across regenerate and period changes', async () => {
    const f = await newFirm()
    const ids = await seedApprovedHours(f, { entries: [{ workDate: MON, hours: '8' }] })
    const invoiceId = await mustCreateDraft(f, ids.clientId)
    expect(await filterOf(invoiceId)).toBeNull()
    expect(await lines(invoiceId)).toHaveLength(1)

    let r = await f.manager.db.rpc('regenerate_invoice_lines', { p_invoice: invoiceId, p_consultants: [] })
    expect(r.error).toBeNull()
    expect(await filterOf(invoiceId)).toEqual([])
    expect(await lines(invoiceId)).toHaveLength(0)

    r = await f.manager.db.rpc('update_invoice_period', {
      p_invoice: invoiceId,
      p_start: START,
      p_end: END,
      p_consultants: await filterOf(invoiceId),
    })
    expect(r.error).toBeNull()
    expect(await filterOf(invoiceId)).toEqual([])
    expect(await lines(invoiceId)).toHaveLength(0)

    r = await f.manager.db.rpc('regenerate_invoice_lines', {
      p_invoice: invoiceId,
      p_consultants: [ids.consultantId],
    })
    expect(r.error).toBeNull()
    expect(await filterOf(invoiceId)).toEqual([ids.consultantId])
    expect(await lines(invoiceId)).toHaveLength(1)
  })

  it('create stores the selection it was given', async () => {
    const f = await newFirm()
    const ids = await seedApprovedHours(f, { entries: [{ workDate: MON, hours: '8' }] })
    const invoiceId = await mustCreateDraft(f, ids.clientId, { consultants: [] })
    expect(await filterOf(invoiceId)).toEqual([])
  })

  it('widening the period with no filter picks up a consultant whose hours are only in the added days', async () => {
    const f = await newFirm()
    const a = await seedApprovedHours(f, {
      consultantName: 'Alice Able',
      entries: [{ workDate: MON, hours: '5' }],
    })
    const b = await seedApprovedHours(f, {
      clientId: a.clientId,
      projectId: a.projectId,
      consultantName: 'Bob Baker',
      linkUser: false,
      entries: [{ workDate: WED, hours: '3' }],
    })
    const invoiceId = await mustCreateDraft(f, a.clientId, { start: START, end: MON })
    expect((await lines(invoiceId)).map((l) => l.consultant_id)).toEqual([a.consultantId])

    const r = await f.manager.db.rpc('update_invoice_period', {
      p_invoice: invoiceId,
      p_start: START,
      p_end: END,
      p_consultants: null,
    })
    expect(r.error).toBeNull()
    expect(await filterOf(invoiceId)).toBeNull()
    expect((await lines(invoiceId)).map((l) => l.consultant_id)).toEqual([a.consultantId, b.consultantId])
  })
})

describe('access and lifecycle', () => {
  it("consultant can't touch drafts; other firms can't either", async () => {
    const { f, ids, invoiceId } = await roundingDraft()
    let r = await createDraft(f, ids.clientId, { user: f.consultant })
    expect(r.error?.code).toBe('42501')
    r = await saveManual(f.consultant, invoiceId, null, 'Sneaky', '1', '1')
    expect(r.error?.code).toBe('42501')

    const b = await newFirm('Firm B')
    r = await saveManual(b.manager, invoiceId, null, 'Cross-firm', '1', '1')
    expect(r.error?.code).toBe('42501')
    r = await b.manager.db.rpc('set_invoice_discount', {
      p_invoice: invoiceId,
      p_type: 'amount',
      p_value: 1,
      p_label: null,
    })
    expect(r.error?.code).toBe('42501')
    r = await b.manager.db.rpc('delete_invoice_draft', { p_invoice: invoiceId })
    expect(r.error?.code).toBe('42501')
    expect(await lines(invoiceId)).toHaveLength(1)
    expect((await totals(invoiceId)).total).toBe('1057.94')

    r = await f.manager.db.rpc('regenerate_invoice_lines', {
      p_invoice: crypto.randomUUID(),
      p_consultants: null,
    })
    expect(text(r.error)).toContain('INVOICE_NOT_FOUND')
  })

  it('internal helpers are not callable', async () => {
    const { f, invoiceId } = await roundingDraft()
    const a = await f.manager.db.rpc('invoice_recalc', { p_invoice: invoiceId })
    expect(a.error).not.toBeNull()
    const b = await f.manager.db.rpc('invoice_generate_time_lines', {
      p_invoice: invoiceId,
      p_consultants: null,
    })
    expect(b.error).not.toBeNull()
  })

  it('non-draft invoices cannot be edited', async () => {
    const { f, invoiceId } = await roundingDraft()
    await adminDb()
      .from('invoices')
      .update({ status: 'issued', number: `INV-${crypto.randomUUID()}` })
      .eq('id', invoiceId)
    const r = await saveManual(f.manager, invoiceId, null, 'Late', '1', '1')
    expect(text(r.error)).toContain('INVOICE_STATE')
    const d = await f.manager.db.rpc('delete_invoice_draft', { p_invoice: invoiceId })
    expect(text(d.error)).toContain('INVOICE_STATE')
  })

  it('delete draft', async () => {
    const { f, ids, invoiceId } = await roundingDraft()
    await saveManual(f.manager, invoiceId, null, 'Setup fee', '1', '500')
    const r = await f.manager.db.rpc('delete_invoice_draft', { p_invoice: invoiceId })
    expect(r.error).toBeNull()
    const { count: invCount } = await adminDb()
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('id', invoiceId)
    expect(invCount).toBe(0)
    expect(await lines(invoiceId)).toHaveLength(0)
    const { data: entries } = await adminDb()
      .from('time_entries')
      .select('hours::text, invoice_line_id')
      .eq('timesheet_id', ids.timesheetId)
    expect(entries).toEqual([{ hours: '7.33', invoice_line_id: null }])
  })
})
