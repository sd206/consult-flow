import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireFirmRole } from '@/lib/auth/context'
import { isIsoDate } from '@/lib/domain/dates'
import { addDays, currentWeekStart, formatDayLabel, isFutureWeek, weekStartOf } from '@/lib/domain/weeks'
import { getMyConsultant, getTimesheetWeek } from '@/modules/timesheets/data'
import { STATUS_LABEL } from './status-label'
import { WeekGrid } from './week-grid'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function TimesheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>
  searchParams: Promise<{ week?: string | string[]; consultant?: string | string[] }>
}) {
  const { firmId } = await params
  const sp = await searchParams
  const weekParam = typeof sp.week === 'string' ? sp.week : undefined
  const consultantParam = typeof sp.consultant === 'string' ? sp.consultant : undefined

  const base = `/f/${firmId}/timesheet`
  const current = currentWeekStart()
  const weekStart = weekParam && isIsoDate(weekParam) ? weekStartOf(weekParam) : current
  const qs = (week: string) =>
    `${base}?week=${week}${consultantParam ? `&consultant=${encodeURIComponent(consultantParam)}` : ''}`
  if (isFutureWeek(weekStart)) redirect(consultantParam ? qs(current) : base)

  let consultantId: string

  const { db } = await requireFirmRole(firmId, consultantParam ? ['admin', 'manager'] : ['admin', 'manager', 'consultant'])
  if (consultantParam) {
    if (!UUID_RE.test(consultantParam)) notFound()
    consultantId = consultantParam
  } else {
    const mine = await getMyConsultant(db, firmId)
    if (!mine.ok) throw new Error(mine.error)
    if (!mine.data) {
      return (
        <div className="max-w-4xl">
          <h1 className="text-2xl font-semibold">My timesheet</h1>
          <p className="mt-4">Your login isn&apos;t linked to a consultant record yet. Ask an Admin to link it.</p>
        </div>
      )
    }
    consultantId = mine.data.id
  }

  const week = await getTimesheetWeek(db, firmId, consultantId, weekStart)
  if (!week.ok) {
    if (consultantParam) notFound()
    throw new Error(week.error)
  }
  const w = week.data
  const heading = consultantParam ? `Timesheet: ${w.consultantName}` : 'My timesheet'
  const nextWeek = addDays(weekStart, 7)

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <h2 className="mt-1 text-lg font-medium">Week of {formatDayLabel(weekStart)}</h2>
      <p className="mt-2 flex gap-4 text-sm">
        <Link href={qs(addDays(weekStart, -7))} className="underline underline-offset-4">
          Previous week
        </Link>
        {!isFutureWeek(nextWeek) && (
          <Link href={qs(nextWeek)} className="underline underline-offset-4">
            Next week
          </Link>
        )}
      </p>
      <p className="mt-2 text-sm">
        Status: <span data-testid="status">{STATUS_LABEL[w.status]}</span>
      </p>
      {w.status === 'rejected' && w.decisionComment && (
        <div className="mt-3 rounded-lg border p-3 text-sm">
          <p className="font-medium">Changes requested:</p>
          <p>{w.decisionComment}</p>
        </div>
      )}
      <WeekGrid
        key={`${w.consultantId}:${w.weekStart}:${w.editable}`}
        firmId={firmId}
        consultantId={w.consultantId}
        weekStart={w.weekStart}
        projects={w.projects}
        entries={w.entries.map((e) => ({ projectId: e.projectId, workDate: e.workDate, hours: e.hours, note: e.note }))}
        editable={w.editable}
      />
    </div>
  )
}
