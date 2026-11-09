import { todayIso } from './dates'

const MS_PER_DAY = 86_400_000

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

/** Add n days (may be negative) to a YYYY-MM-DD date, in UTC. */
export function addDays(date: string, n: number): string {
  return new Date(toUtc(date).getTime() + n * MS_PER_DAY).toISOString().slice(0, 10)
}

/** The Monday on or before the given date. */
export function weekStartOf(date: string): string {
  const dow = toUtc(date).getUTCDay() // 0 = Sunday
  return addDays(date, -((dow + 6) % 7))
}

/** Seven dates, Monday to Sunday. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

export function currentWeekStart(now: Date = new Date()): string {
  return weekStartOf(todayIso(now))
}

export function isFutureWeek(weekStart: string, now: Date = new Date()): boolean {
  return weekStart > currentWeekStart(now)
}

/** e.g. 'Mon 9 Nov' — deterministic: en-GB, UTC. */
export function formatDayLabel(date: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).formatToParts(toUtc(date))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('weekday')} ${get('day')} ${get('month')}`
}
