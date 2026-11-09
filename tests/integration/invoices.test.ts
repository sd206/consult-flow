import { beforeAll, describe, expect, it } from 'vitest'
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  setDefaultTemplate,
  updateTemplate,
} from '@/modules/invoice-templates/data'
import { DEFAULT_TEMPLATE_OPTIONS } from '@/modules/invoice-templates/schemas'
import {
  createDraft,
  deleteDraft,
  getInvoice,
  issueInvoice,
  listCandidates,
  listInvoices,
  saveManualLine,
  setDiscount,
  voidInvoice,
} from '@/modules/invoices/data'
import { generateAndStorePdf, loadInvoiceDocument, readStoredPdf } from '@/modules/invoices/pdf/storage'
import { newFirm } from './helpers'
import { seedApprovedHours } from './invoice-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>

const START = '2026-10-01'
const END = '2026-10-31'
const input = (name: string) => ({
  name,
  baseLayout: 'modern' as const,
  options: { ...DEFAULT_TEMPLATE_OPTIONS, accentColor: '#112233' },
})

function must<T>(r: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.data
}

describe('invoice templates data', () => {
  let f: Firm
  beforeAll(async () => {
    f = await newFirm('Tpl Firm')
  })

  it('CRUD and default switching', async () => {
    const list0 = must(await listTemplates(f.admin.db, f.firmId))
    expect(list0.filter((t) => t.isDefault)).toHaveLength(1)
    const original = list0.find((t) => t.isDefault)!

    const { id } = must(await createTemplate(f.admin.db, f.firmId, input('Fancy')))
    const got = must(await getTemplate(f.admin.db, f.firmId, id))
    expect(got).toMatchObject({ name: 'Fancy', baseLayout: 'modern', isDefault: false })
    expect(got.options.accentColor).toBe('#112233')

    must(await updateTemplate(f.admin.db, f.firmId, id, { ...input('Fancier'), baseLayout: 'compact' }))
    expect(must(await getTemplate(f.admin.db, f.firmId, id))).toMatchObject({ name: 'Fancier', baseLayout: 'compact', isDefault: false })

    must(await setDefaultTemplate(f.admin.db, f.firmId, id))
    const after = must(await listTemplates(f.admin.db, f.firmId))
    expect(after.filter((t) => t.isDefault).map((t) => t.id)).toEqual([id])

    const del = await deleteTemplate(f.admin.db, f.firmId, id)
    expect(del).toEqual({ ok: false, error: "The default template can't be deleted. Make another template the default first." })
    must(await setDefaultTemplate(f.admin.db, f.firmId, original.id))
    must(await deleteTemplate(f.admin.db, f.firmId, id))
    expect((await getTemplate(f.admin.db, f.firmId, id)).ok).toBe(false)
  })

  it('a manager can read but not create', async () => {
    expect(must(await listTemplates(f.manager.db, f.firmId)).length).toBeGreaterThan(0)
    const r = await createTemplate(f.manager.db, f.firmId, input('Nope'))
    expect(r).toEqual({ ok: false, error: "You don't have permission to do that." })
  })
})

describe('invoices data', () => {
  let f: Firm
  let clientId: string
  let templateId: string
  beforeAll(async () => {
    f = await newFirm('Inv Firm')
    const ids = await seedApprovedHours(f, {
      entries: [
        { workDate: '2026-10-05', hours: '8', note: 'Discovery' },
        { workDate: '2026-10-06', hours: '7.5', note: 'Workshop' },
      ],
    })
    clientId = ids.clientId
    templateId = must(await listTemplates(f.manager.db, f.firmId)).find((t) => t.isDefault)!.id
  })

  const draft = async () =>
    must(await createDraft(f.manager.db, f.firmId, { clientId, periodStart: START, periodEnd: END, templateId, consultantIds: null })).id

  it('lists candidates', async () => {
    const rows = must(await listCandidates(f.manager.db, f.firmId, clientId, START, END))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ hours: '15.50', rate: '133.33', entryCount: 2 })
  })

  it('creates, edits, discounts, issues and voids', async () => {
    const id = await draft()
    const inv = must(await getInvoice(f.manager.db, f.firmId, id))
    expect(inv.status).toBe('draft')
    expect(inv.lines.filter((l) => l.kind === 'time')).toHaveLength(1)
    expect(inv.billTo).toBeNull()
    expect(inv.consultantIds).toHaveLength(1)
    expect(typeof inv.subtotal).toBe('string')
    expect(inv.subtotal).toBe('2066.62')

    must(await saveManualLine(f.manager.db, f.firmId, id, { lineId: null, description: 'Expenses', quantity: '1', unitPrice: '10.00' }))
    expect(must(await getInvoice(f.manager.db, f.firmId, id)).lines).toHaveLength(2)

    must(await setDiscount(f.manager.db, f.firmId, id, { type: 'percent', value: '10', label: 'Loyalty' }))
    const d = must(await getInvoice(f.manager.db, f.firmId, id))
    expect(d.discountAmount).toBe('207.66')
    expect(d.total).toBe('1868.96')

    const issued = must(await issueInvoice(f.manager.db, f.firmId, id))
    expect(typeof issued.number).toBe('string')
    const after = must(await getInvoice(f.manager.db, f.firmId, id))
    expect(after.status).toBe('issued')
    expect(after.number).toBe(issued.number)
    expect(after.billTo?.name).toBeTruthy()

    must(await voidInvoice(f.manager.db, f.firmId, id))
    expect(must(await getInvoice(f.manager.db, f.firmId, id)).status).toBe('void')
    const voided = must(await listInvoices(f.manager.db, f.firmId, { status: 'void' }))
    expect(voided.map((r) => r.id)).toContain(id)
    expect(voided[0]?.clientName).toBeTruthy()
  })

  it('maps data errors', async () => {
    const empty = must(await createDraft(f.manager.db, f.firmId, { clientId, periodStart: '2026-01-01', periodEnd: '2026-01-31', templateId, consultantIds: null })).id
    expect(await issueInvoice(f.manager.db, f.firmId, empty)).toEqual({ ok: false, error: 'Add at least one line before issuing.' })
    must(await deleteDraft(f.manager.db, f.firmId, empty))
    expect(await getInvoice(f.manager.db, f.firmId, empty)).toEqual({ ok: false, error: 'Invoice not found.' })
  })
})

describe('invoice PDF storage', () => {
  let f: Firm
  let clientId: string
  let templateId: string
  beforeAll(async () => {
    f = await newFirm('Pdf Firm')
    const ids = await seedApprovedHours(f, {
      entries: [
        { workDate: '2026-10-05', hours: '8', note: 'Discovery' },
        { workDate: '2026-10-06', hours: '7.5', note: 'Workshop' },
      ],
    })
    clientId = ids.clientId
    templateId = must(await listTemplates(f.manager.db, f.firmId)).find((t) => t.isDefault)!.id
  })

  // Hours are consumed by the first issue, so later invoices bill a manual line instead.
  const issued = async (period: [string, string] = ['2026-01-01', '2026-01-31']) => {
    const id = must(
      await createDraft(f.manager.db, f.firmId, { clientId, periodStart: period[0], periodEnd: period[1], templateId, consultantIds: null }),
    ).id
    if (period[0] !== START) {
      must(await saveManualLine(f.manager.db, f.firmId, id, { lineId: null, description: 'Fee', quantity: '1', unitPrice: '10.00' }))
    }
    must(await issueInvoice(f.manager.db, f.firmId, id))
    return id
  }

  it('renders, stores and reads back an issued invoice PDF', async () => {
    const id = await issued([START, END])
    const { path } = must(await generateAndStorePdf(f.manager.db, f.firmId, id))
    expect(path.startsWith(`firms/${f.firmId}/invoices/${id}/`)).toBe(true)
    expect(path.endsWith('.pdf')).toBe(true)
    expect(must(await getInvoice(f.manager.db, f.firmId, id)).pdfPath).toBe(path)
    const bytes = must(await readStoredPdf(f.manager.db, path))
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-')
  })

  it('leaves the invoice issued with no PDF when rendering fails', async () => {
    const id = await issued()
    const r = await generateAndStorePdf(f.manager.db, f.firmId, id, async () => {
      throw new Error('boom')
    }).catch(() => ({ ok: false as const }))
    expect(r.ok).toBe(false)
    const inv = must(await getInvoice(f.manager.db, f.firmId, id))
    expect(inv.status).toBe('issued')
    expect(inv.pdfPath).toBeNull()
  })
})

describe('invoice document detail entries', () => {
  it('lists the hours for a draft preview and again after issuing', async () => {
    const f = await newFirm('Detail Firm')
    const ids = await seedApprovedHours(f, {
      entries: [
        { workDate: '2026-10-06', hours: '7.5', note: 'Workshop' },
        { workDate: '2026-10-05', hours: '8', note: 'Discovery' },
      ],
    })
    const tpl = must(
      await createTemplate(f.admin.db, f.firmId, {
        name: 'Detailed',
        baseLayout: 'classic',
        options: { ...DEFAULT_TEMPLATE_OPTIONS, showDailyDetail: true },
      }),
    )
    const id = must(
      await createDraft(f.manager.db, f.firmId, { clientId: ids.clientId, periodStart: START, periodEnd: END, templateId: tpl.id, consultantIds: null }),
    ).id
    const draft = must(await loadInvoiceDocument(f.manager.db, f.firmId, id))
    expect(draft.title).toBe('Draft invoice')
    expect(draft.detail?.map((d) => [d.date, d.hours, d.note])).toEqual([
      ['5 Oct 2026', '8.00', 'Discovery'],
      ['6 Oct 2026', '7.50', 'Workshop'],
    ])
    must(await issueInvoice(f.manager.db, f.firmId, id))
    const issued = must(await loadInvoiceDocument(f.manager.db, f.firmId, id))
    expect(issued.title).toBe('Invoice')
    expect(issued.detail).toHaveLength(2)
  })
})
