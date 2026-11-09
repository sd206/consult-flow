import { describe, expect, it } from 'vitest'
import { discountSchema, headerSchema, manualLineSchema } from './schemas'

describe('invoice schemas', () => {
  it('discount label max 60', () => {
    const r = discountSchema.safeParse({ type: 'percent', value: '10', label: 'x'.repeat(61) })
    expect(r.success).toBe(false)
  })
  it('discount percent canonicalises and bounds', () => {
    expect(discountSchema.parse({ type: 'percent', value: '12.5', label: '' })).toEqual({ type: 'percent', value: '12.50', label: null })
    expect(discountSchema.safeParse({ type: 'percent', value: '101', label: '' }).success).toBe(false)
    expect(discountSchema.parse({ type: 'amount', value: '1,000', label: 'Promo' }).value).toBe('1000.00')
  })
  it('manual line quantity must be above 0 with 2dp', () => {
    const base = { description: 'x', unitPrice: '5' }
    expect(manualLineSchema.safeParse({ ...base, quantity: '0' }).success).toBe(false)
    expect(manualLineSchema.safeParse({ ...base, quantity: '1.234' }).success).toBe(false)
    expect(manualLineSchema.parse({ ...base, quantity: '2' }).quantity).toBe('2.00')
  })
  it('header requires due on or after issue and tax 0-100', () => {
    const base = { subject: '', issueDate: '2026-11-01', dueDate: '2026-11-01', taxPercent: '8.25', templateId: 't' }
    expect(headerSchema.parse(base).taxPercent).toBe('8.25')
    expect(headerSchema.safeParse({ ...base, dueDate: '2026-10-31' }).success).toBe(false)
    expect(headerSchema.safeParse({ ...base, taxPercent: '100.01' }).success).toBe(false)
  })
})
