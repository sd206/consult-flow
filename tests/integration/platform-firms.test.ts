import { describe, expect, it } from 'vitest'
import { adminDb, newFirm, signIn } from './helpers'

type Row = { id: string; name: string; admin_emails: string[]; total_count: number }

describe('platform_firms', () => {
  it('lists firms newest first, searches by name, pages and counts', async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const a = await newFirm(`Paging ${tag} Alpha`)
    const b = await newFirm(`Paging ${tag} Beta`)
    const c = await newFirm(`Paging ${tag} Gamma`)
    const owner = await signIn('owner@local.test', 'owner-password-123')

    const page = (search: string | null, limit: number, offset: number) =>
      owner.db.rpc('platform_firms', { p_search: search, p_limit: limit, p_offset: offset })

    const all = await page(`paging ${tag}`, 50, 0)
    expect(all.error).toBeNull()
    const rows = all.data as Row[]
    expect(rows.map((r) => r.id)).toEqual([c.firmId, b.firmId, a.firmId])
    expect(rows.every((r) => r.total_count === 3)).toBe(true)
    expect(rows[0].admin_emails).toEqual([c.admin.email])

    const second = (await page(`paging ${tag}`, 2, 2)).data as Row[]
    expect(second.map((r) => r.id)).toEqual([a.firmId])
    expect(second[0].total_count).toBe(3)

    expect(((await page(`${tag} beta`, 50, 0)).data as Row[]).map((r) => r.id)).toEqual([b.firmId])

    // Unfiltered, the newest firm is first even when there are more than 1,000.
    const newest = (await page(null, 1, 0)).data as Row[]
    const { data: latest } = await adminDb().from('firms').select('id').order('created_at', { ascending: false }).limit(1).single()
    expect(newest[0].id).toBe(latest!.id)
  })

  it('returns nothing to someone who is not the platform owner', async () => {
    const f = await newFirm('Paging Not Owner')
    const r = await f.admin.db.rpc('platform_firms', { p_search: null, p_limit: 50, p_offset: 0 })
    expect(r.error).toBeNull()
    expect(r.data).toEqual([])
  })
})
