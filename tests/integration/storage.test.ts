import { describe, expect, it } from 'vitest'
import { adminDb, anonDb, newFirm } from './helpers'

const BUCKET = 'firm-files'
const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })

async function exists(path: string): Promise<boolean> {
  const idx = path.lastIndexOf('/')
  const dir = path.slice(0, idx)
  const file = path.slice(idx + 1)
  const { data, error } = await adminDb().storage.from(BUCKET).list(dir)
  expect(error).toBeNull()
  return (data ?? []).some((o) => o.name === file)
}

describe('firm-files storage', () => {
  it('bucket is private', async () => {
    const { data, error } = await adminDb().storage.getBucket(BUCKET)
    expect(error).toBeNull()
    expect(data?.public).toBe(false)
  })

  it('admin uploads logo; consultant of same firm can download', async () => {
    const f = await newFirm()
    const path = `firms/${f.firmId}/logo/x.png`
    const up = await f.admin.db.storage.from(BUCKET).upload(path, png())
    expect(up.error).toBeNull()
    expect(await exists(path)).toBe(true)
    const dl = await f.consultant.db.storage.from(BUCKET).download(path)
    expect(dl.error).toBeNull()
    expect(dl.data).not.toBeNull()
  })

  it('consultant cannot read non-logo firm files; manager and admin can', async () => {
    const f = await newFirm()
    // Users may only create holding objects under attachments/ (20261109000022_storage_hardening.sql).
    const dir = `firms/${f.firmId}/attachments/payments/${crypto.randomUUID()}`
    const file = `incoming-${crypto.randomUUID()}`
    const path = `${dir}/${file}`
    const pdf = new Blob([new TextEncoder().encode('%PDF-1.4')], { type: 'application/pdf' })
    expect((await f.manager.db.storage.from(BUCKET).upload(path, pdf)).error).toBeNull()

    const denied = await f.consultant.db.storage.from(BUCKET).download(path)
    expect(denied.error).not.toBeNull()
    expect(denied.data).toBeNull()
    const listed = await f.consultant.db.storage.from(BUCKET).list(dir)
    expect((listed.data ?? []).map((o) => o.name)).not.toContain(file)
    const signed = await f.consultant.db.storage.from(BUCKET).createSignedUrl(path, 60)
    expect(signed.error).not.toBeNull()

    const byManager = await f.manager.db.storage.from(BUCKET).download(path)
    expect(byManager.error).toBeNull()
    expect(byManager.data).not.toBeNull()
    expect((await f.admin.db.storage.from(BUCKET).download(path)).error).toBeNull()
  })

  it('manager cannot write logo path, but can write elsewhere in firm', async () => {
    const f = await newFirm()
    const logo = `firms/${f.firmId}/logo/m.png`
    const up = await f.manager.db.storage.from(BUCKET).upload(logo, png())
    expect(up.error).not.toBeNull()
    expect(await exists(logo)).toBe(false)
    const other = `firms/${f.firmId}/attachments/payments/${crypto.randomUUID()}/incoming-${crypto.randomUUID()}`
    const ok = await f.manager.db.storage.from(BUCKET).upload(other, png())
    expect(ok.error).toBeNull()
    expect(await exists(other)).toBe(true)
  })

  it('consultant cannot write anywhere', async () => {
    const f = await newFirm()
    for (const p of [
      `firms/${f.firmId}/logo/c.png`,
      `firms/${f.firmId}/attachments/payments/${crypto.randomUUID()}/incoming-${crypto.randomUUID()}`,
      `firms/${f.firmId}/invoices/${crypto.randomUUID()}/c.pdf`,
    ]) {
      const up = await f.consultant.db.storage.from(BUCKET).upload(p, png())
      expect(up.error).not.toBeNull()
      expect(await exists(p)).toBe(false)
    }
  })

  it('other firm cannot download, upload, overwrite, or delete', async () => {
    const a = await newFirm('A')
    const b = await newFirm('B')
    const path = `firms/${a.firmId}/logo/x.png`
    expect((await a.admin.db.storage.from(BUCKET).upload(path, png())).error).toBeNull()

    expect((await b.consultant.db.storage.from(BUCKET).download(path)).error).not.toBeNull()

    const evil = `firms/${a.firmId}/logo/y.png`
    expect((await b.admin.db.storage.from(BUCKET).upload(evil, png())).error).not.toBeNull()
    expect(await exists(evil)).toBe(false)

    const over = await b.admin.db.storage.from(BUCKET).upload(path, png(), { upsert: true })
    expect(over.error).not.toBeNull()

    await b.admin.db.storage.from(BUCKET).remove([path])
    expect(await exists(path)).toBe(true)
  })

  it('admin can overwrite and delete own logo; manager cannot delete it', async () => {
    const f = await newFirm()
    const path = `firms/${f.firmId}/logo/z.png`
    expect((await f.admin.db.storage.from(BUCKET).upload(path, png())).error).toBeNull()
    expect((await f.admin.db.storage.from(BUCKET).upload(path, png(), { upsert: true })).error).toBeNull()
    await f.manager.db.storage.from(BUCKET).remove([path])
    expect(await exists(path)).toBe(true)
    const rm = await f.admin.db.storage.from(BUCKET).remove([path])
    expect(rm.error).toBeNull()
    expect(await exists(path)).toBe(false)
  })

  it('malformed paths are cleanly denied', async () => {
    const f = await newFirm()
    for (const p of ['other/x.png', 'firms/not-a-uuid/x.png', `firms/${f.firmId}.png`]) {
      const up = await f.admin.db.storage.from(BUCKET).upload(p, png())
      expect(up.error).not.toBeNull()
      expect(JSON.stringify(up.error)).not.toMatch(/invalid input syntax/i)
      const dl = await f.admin.db.storage.from(BUCKET).download(p)
      expect(dl.error).not.toBeNull()
    }
    expect(await exists('other/x.png')).toBe(false)
    expect(await exists('firms/not-a-uuid/x.png')).toBe(false)
  })

  it('anon has no access', async () => {
    const f = await newFirm()
    const path = `firms/${f.firmId}/logo/a.png`
    expect((await f.admin.db.storage.from(BUCKET).upload(path, png())).error).toBeNull()
    expect((await anonDb().storage.from(BUCKET).download(path)).error).not.toBeNull()
    const up = await anonDb().storage.from(BUCKET).upload(`firms/${f.firmId}/logo/b.png`, png())
    expect(up.error).not.toBeNull()
  })
})
