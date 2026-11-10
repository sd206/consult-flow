import { describe, expect, it } from 'vitest'
import { newExpenseSchema } from './schemas'

const base = { spentOn: '2026-10-15', categoryId: crypto.randomUUID(), payee: 'Acme', amount: '10.00', clientId: '', projectId: '', notes: '' }

describe('newExpenseSchema', () => {
  it('requires the form id to be a uuid', () => {
    const id = crypto.randomUUID()
    const ok = newExpenseSchema.safeParse({ ...base, id })
    expect(ok.success && ok.data.id).toBe(id)
    for (const bad of ['', 'x', `${id}x`]) {
      const r = newExpenseSchema.safeParse({ ...base, id: bad })
      expect(r.success, bad).toBe(false)
      expect(r.error?.issues[0].path).toEqual(['id'])
    }
  })
})
