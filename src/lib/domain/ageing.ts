export type AgeBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'

export const AGE_BUCKET_LABELS: Record<AgeBucket, string> = {
  current: 'Not yet due',
  d1_30: '1–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90_plus: 'Over 90 days',
}

export function bucketFor(daysOverdue: number): AgeBucket {
  if (daysOverdue <= 0) return 'current'
  if (daysOverdue <= 30) return 'd1_30'
  if (daysOverdue <= 60) return 'd31_60'
  if (daysOverdue <= 90) return 'd61_90'
  return 'd90_plus'
}

export function overdueLabel(daysOverdue: number): string | null {
  if (daysOverdue <= 0) return null
  return daysOverdue === 1 ? 'Overdue by 1 day' : `Overdue by ${daysOverdue} days`
}
