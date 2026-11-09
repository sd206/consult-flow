import { describe, expect, it } from 'vitest'
import { AGE_BUCKET_LABELS, bucketFor, overdueLabel } from './ageing'

describe('bucketFor', () => {
  it.each([
    [-5, 'current'],
    [0, 'current'],
    [1, 'd1_30'],
    [30, 'd1_30'],
    [31, 'd31_60'],
    [60, 'd31_60'],
    [61, 'd61_90'],
    [90, 'd61_90'],
    [91, 'd90_plus'],
  ])('%i days -> %s', (days, bucket) => {
    expect(bucketFor(days)).toBe(bucket)
  })
})

describe('overdueLabel', () => {
  it('formats', () => {
    expect(overdueLabel(0)).toBeNull()
    expect(overdueLabel(-3)).toBeNull()
    expect(overdueLabel(1)).toBe('Overdue by 1 day')
    expect(overdueLabel(45)).toBe('Overdue by 45 days')
  })
})

describe('AGE_BUCKET_LABELS', () => {
  it('has the labels', () => {
    expect(AGE_BUCKET_LABELS).toEqual({
      current: 'Not yet due',
      d1_30: '1–30 days',
      d31_60: '31–60 days',
      d61_90: '61–90 days',
      d90_plus: 'Over 90 days',
    })
  })
})
