import { describe, expect, it } from 'vitest'
import { displayFileName, MAX_ATTACHMENT_BYTES, validateAttachment } from './attachments'

const enc = (s: string) => new TextEncoder().encode(s)
const PDF = enc('%PDF-1.4')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
const heic = (brand: string) => new Uint8Array([0, 0, 0, 0x18, ...enc('ftyp'), ...enc(brand)])

const file = (name: string, type: string, bytes: Uint8Array) => ({ name, type, size: bytes.length, bytes })
const TYPE_MSG = 'Only PDF, PNG, JPEG or HEIC files can be attached.'
const SIZE_MSG = 'Each file must be 10 MB or smaller.'

describe('validateAttachment', () => {
  it('accepts each supported kind by signature', () => {
    expect(validateAttachment(file('a.pdf', 'application/pdf', PDF))).toEqual({
      ok: true,
      data: { kind: 'pdf', ext: 'pdf', mime: 'application/pdf' },
    })
    expect(validateAttachment(file('a.png', 'image/png', PNG))).toEqual({
      ok: true,
      data: { kind: 'png', ext: 'png', mime: 'image/png' },
    })
    expect(validateAttachment(file('a.jpg', 'image/jpeg', JPEG))).toEqual({
      ok: true,
      data: { kind: 'jpeg', ext: 'jpg', mime: 'image/jpeg' },
    })
    for (const brand of ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']) {
      expect(validateAttachment(file('a.heic', 'image/heic', heic(brand)))).toEqual({
        ok: true,
        data: { kind: 'heic', ext: 'heic', mime: 'image/heic' },
      })
    }
  })

  it('rejects an unknown ftyp brand', () => {
    expect(validateAttachment(file('a.heic', 'image/heic', heic('mp42')))).toEqual({ ok: false, error: TYPE_MSG })
  })

  it('trusts the signature over the declared type and name', () => {
    const r = validateAttachment(file('scan.pdf', 'application/pdf', PNG))
    expect(r).toEqual({ ok: true, data: { kind: 'png', ext: 'png', mime: 'image/png' } })
  })

  it('rejects a disguised file', () => {
    expect(validateAttachment(file('invoice.pdf', 'application/pdf', enc('MZ\x90\x00')))).toEqual({
      ok: false,
      error: TYPE_MSG,
    })
  })

  it('enforces size limits', () => {
    expect(validateAttachment({ name: 'a.pdf', type: 'application/pdf', size: 0, bytes: new Uint8Array(0) })).toEqual({
      ok: false,
      error: 'That file is empty.',
    })
    const tooBig = new Uint8Array(MAX_ATTACHMENT_BYTES + 1)
    tooBig.set(PDF)
    expect(validateAttachment(file('a.pdf', 'application/pdf', tooBig))).toEqual({ ok: false, error: SIZE_MSG })
    const exact = new Uint8Array(MAX_ATTACHMENT_BYTES)
    exact.set(PDF)
    expect(MAX_ATTACHMENT_BYTES).toBe(10_485_760)
    expect(validateAttachment(file('a.pdf', 'application/pdf', exact)).ok).toBe(true)
  })
})

describe('displayFileName', () => {
  it('strips path parts and control characters', () => {
    const out = displayFileName('../../etc/pass\u0000wd.pdf')
    expect(out).not.toMatch(/[/\\]/)
    expect(out).not.toMatch(/[\u0000-\u001f\u007f]/)
    expect(out.endsWith('.pdf')).toBe(true)
    expect(displayFileName('C:\\temp\\report.pdf')).toBe('report.pdf')
  })

  it('cuts to 120 characters and falls back to file', () => {
    expect(displayFileName('a'.repeat(200)).length).toBe(120)
    expect(displayFileName('   ')).toBe('file')
    expect(displayFileName('dir/')).toBe('file')
  })
})
