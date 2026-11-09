/** Today's date in UTC as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}
