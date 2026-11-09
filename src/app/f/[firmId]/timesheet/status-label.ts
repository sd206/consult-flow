import type { WeekStatus } from '@/modules/timesheets/data'

export const STATUS_LABEL: Record<WeekStatus, string> = {
  not_started: 'Not started',
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
}
