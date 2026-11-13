import { describe, expect, it } from 'vitest'
import { mapDbError } from '@/lib/db-errors'
import { getFirm, updateFirmSettings, uploadFirmLogo } from '@/modules/firms/data'
import type { FirmSettingsInput } from '@/modules/firms/schemas'
import { adminDb, newFirm } from './helpers'

const DENIED = "You don't have permission to do that."
const LOGO_ERR = 'Logo must be a PNG or JPEG under 2 MB.'

const settings = (over: Partial<FirmSettingsInput> = {}): FirmSettingsInput => ({
  name: 'Renamed Firm',
  address: '1 Main St',
  contactName: 'Pat',
  contactEmail: 'pat@example.com',
  contactPhone: '555-1234',
  currency: 'GBP',
  defaultTaxPercent: '20',
  defaultPaymentTermsDays: 45,
  invoiceNumberPattern: 'SRS-{YYYY}-{SEQ:4}',
  ...over,
})

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2])
const buf = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
const text = (s: string): ArrayBuffer => buf(new TextEncoder().encode(s))
const file = (name: string, type: string, bytes: ArrayBuffer) => ({
  name,
  type,
  size: bytes.byteLength,
  bytes,
})

async function logoObjects(firmId: string): Promise<string[]> {
  const { data, error } = await adminDb().storage.from('firm-files').list(`firms/${firmId}/logo`)
  expect(error).toBeNull()
  return (data ?? []).map((o) => o.name)
}

describe('updateFirmSettings', () => {
  it('admin persists settings', async () => {
    const f = await newFirm()
    const r = await updateFirmSettings(f.admin.db, f.firmId, settings())
    expect(r.ok).toBe(true)
    const { data } = await adminDb().from('firms').select('*').eq('id', f.firmId).single()
    expect(data).toMatchObject({
      name: 'Renamed Firm',
      currency: 'GBP',
      default_tax_percent: 20,
      default_payment_terms_days: 45,
      invoice_number_pattern: 'SRS-{YYYY}-{SEQ:4}',
      contact_email: 'pat@example.com',
    })
  })

  it('rejects an invalid pattern and persists nothing', async () => {
    const f = await newFirm('Keep Name')
    const r = await updateFirmSettings(
      f.admin.db,
      f.firmId,
      settings({ invoiceNumberPattern: 'INV-{YYYY}' }),
    )
    expect(r).toEqual({ ok: false, error: 'Pattern must contain exactly one {SEQ:n}.' })
    const { data } = await adminDb()
      .from('firms')
      .select('name, invoice_number_pattern')
      .eq('id', f.firmId)
      .single()
    expect(data).toEqual({ name: 'Keep Name', invoice_number_pattern: 'INV-{YYYY}-{SEQ:4}' })
  })

  it('manager can update settings too', async () => {
    const f = await newFirm('Manager Target')
    const r = await updateFirmSettings(f.manager.db, f.firmId, { ...settings(), name: 'Renamed by manager' })
    expect(r.ok).toBe(true)
    const { data } = await adminDb().from('firms').select('name').eq('id', f.firmId).single()
    expect(data?.name).toBe('Renamed by manager')
  })

  it('consultant is denied (0 rows updated)', async () => {
    const f = await newFirm('Consultant Target')
    const r = await updateFirmSettings(f.consultant.db, f.firmId, settings())
    expect(r).toEqual({ ok: false, error: DENIED })
    const { data } = await adminDb().from('firms').select('name').eq('id', f.firmId).single()
    expect(data?.name).toBe('Consultant Target')
  })

  it('admin cannot update invoice_next_seq via PostgREST', async () => {
    const f = await newFirm()
    const { error } = await f.admin.db
      .from('firms')
      .update({ invoice_next_seq: 99 })
      .eq('id', f.firmId)
    expect(error).not.toBeNull()
    const { data } = await adminDb()
      .from('firms')
      .select('invoice_next_seq')
      .eq('id', f.firmId)
      .single()
    expect(data?.invoice_next_seq).toBe(1)
  })

  it('db rejects a pattern without {SEQ:n}, naming the constraint', async () => {
    const f = await newFirm()
    const { error } = await adminDb()
      .from('firms')
      .update({ invoice_number_pattern: 'INV-{YYYY}' })
      .eq('id', f.firmId)
    expect(error?.message).toContain('firms_invoice_pattern_seq_chk')
  })

  it('db rejects payment terms over 365 days', async () => {
    const f = await newFirm()
    const { error } = await adminDb()
      .from('firms')
      .update({ default_payment_terms_days: 366 })
      .eq('id', f.firmId)
    expect(error?.message).toContain('firms_payment_terms_chk')
  })
})

describe('uploadFirmLogo', () => {
  it('rejects a 12 MB PNG', async () => {
    const f = await newFirm()
    const big = new Uint8Array(12 * 1024 * 1024)
    big.set(PNG_BYTES)
    const r = await uploadFirmLogo(f.admin.db, f.firmId, file('big.png', 'image/png', buf(big)))
    expect(r).toEqual({ ok: false, error: LOGO_ERR })
    expect(await logoObjects(f.firmId)).toEqual([])
  })

  it('rejects an executable declared as PNG', async () => {
    const f = await newFirm()
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0])
    const r = await uploadFirmLogo(f.admin.db, f.firmId, file('x.png', 'image/png', buf(exe)))
    expect(r).toEqual({ ok: false, error: LOGO_ERR })
    expect(await logoObjects(f.firmId)).toEqual([])
  })

  it('rejects disallowed MIME types', async () => {
    const f = await newFirm()
    const r = await uploadFirmLogo(f.admin.db, f.firmId, file('x.gif', 'image/gif', buf(PNG_BYTES)))
    expect(r).toEqual({ ok: false, error: LOGO_ERR })
  })

  it('rejects SVG logos, even clean ones', async () => {
    const f = await newFirm()
    const r = await uploadFirmLogo(
      f.admin.db,
      f.firmId,
      file(
        'x.svg',
        'image/svg+xml',
        text('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'),
      ),
    )
    expect(r).toEqual({ ok: false, error: LOGO_ERR })
    expect(await logoObjects(f.firmId)).toEqual([])
  })

  it('manager can upload a logo', async () => {
    const f = await newFirm()
    const r = await uploadFirmLogo(f.manager.db, f.firmId, file('x.png', 'image/png', buf(PNG_BYTES)))
    expect(r.ok).toBe(true)
    expect(await logoObjects(f.firmId)).toHaveLength(1)
  })

  it('consultant cannot upload a logo', async () => {
    const f = await newFirm()
    const r = await uploadFirmLogo(f.consultant.db, f.firmId, file('x.png', 'image/png', buf(PNG_BYTES)))
    expect(r.ok).toBe(false)
    expect(await logoObjects(f.firmId)).toEqual([])
  })

  it('valid upload sets logo_path; a second upload replaces and removes the first', async () => {
    const f = await newFirm()
    const first = await uploadFirmLogo(f.admin.db, f.firmId, file('a.png', 'image/png', buf(PNG_BYTES)))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.logoPath).toMatch(
      new RegExp(`^firms/${f.firmId}/logo/[0-9a-f-]{36}\\.png$`),
    )
    const { data: row } = await adminDb().from('firms').select('logo_path').eq('id', f.firmId).single()
    expect(row?.logo_path).toBe(first.data.logoPath)

    const second = await uploadFirmLogo(f.admin.db, f.firmId, file('b.jpg', 'image/jpeg', buf(JPEG_BYTES)))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(await logoObjects(f.firmId)).toEqual([second.data.logoPath.split('/').pop()])
    const { data: row2 } = await adminDb().from('firms').select('logo_path').eq('id', f.firmId).single()
    expect(row2?.logo_path).toBe(second.data.logoPath)
  })

  it("db rejects a logo_path outside the firm's own logo folder, naming the constraint", async () => {
    const a = await newFirm('Path Firm A')
    const b = await newFirm('Path Firm B')
    const { error } = await a.admin.db
      .from('firms')
      .update({ logo_path: `firms/${b.firmId}/logo/x.png` })
      .eq('id', a.firmId)
    expect(error?.message).toContain('firms_logo_path_chk')
    const { data } = await adminDb().from('firms').select('logo_path').eq('id', a.firmId).single()
    expect(data?.logo_path).toBeNull()
  })

  it('mapDbError turns the logo_path constraint into a plain message', () => {
    expect(mapDbError({ code: '23514', message: 'new row violates check constraint "firms_logo_path_chk"' })).toBe(
      "That logo file doesn't belong to this firm.",
    )
  })
})

describe('getFirm', () => {
  it('returns the firm with a signed logoUrl when a logo is set', async () => {
    const f = await newFirm('Logo Firm')
    const none = await getFirm(f.admin.db, f.firmId)
    expect(none.ok && none.data.logoUrl).toBeNull()
    await uploadFirmLogo(f.admin.db, f.firmId, file('a.png', 'image/png', buf(PNG_BYTES)))
    const r = await getFirm(f.admin.db, f.firmId)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.name).toBe('Logo Firm')
    expect(r.data.logoUrl).toMatch(/^https?:\/\//)
  })

  it('returns default_tax_percent exactly as stored', async () => {
    const f = await newFirm()
    await adminDb().from('firms').update({ default_tax_percent: '8.50' }).eq('id', f.firmId)
    const r = await getFirm(f.admin.db, f.firmId)
    expect(r.ok && r.data.defaultTaxPercent).toBe('8.50')
  })
})
