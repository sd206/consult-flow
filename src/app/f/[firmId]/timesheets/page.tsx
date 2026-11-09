import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import { isIsoDate } from '@/lib/domain/dates'
import { addDays, currentWeekStart, formatDayLabel, isFutureWeek, weekStartOf } from '@/lib/domain/weeks'
import { listAwaitingApproval, listWeekStatus } from '@/modules/timesheets/data'
import { STATUS_LABEL } from '../timesheet/status-label'

const th = 'py-2 pr-4 font-medium'

export default async function TimesheetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>
  searchParams: Promise<{ week?: string | string[] }>
}) {
  const { firmId } = await params
  const sp = await searchParams
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])

  const current = currentWeekStart()
  const weekParam = typeof sp.week === 'string' ? sp.week : undefined
  let weekStart = weekParam && isIsoDate(weekParam) ? weekStartOf(weekParam) : current
  if (isFutureWeek(weekStart)) weekStart = current
  const nextWeek = addDays(weekStart, 7)
  const base = `/f/${firmId}/timesheets`

  const [queue, status] = await Promise.all([listAwaitingApproval(db, firmId), listWeekStatus(db, firmId, weekStart)])

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Timesheets</h1>

      <section aria-labelledby="awaiting-h" className="mt-6">
        <h2 id="awaiting-h" className="text-lg font-medium">
          Awaiting approval
        </h2>
        {!queue.ok ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {queue.error}
          </p>
        ) : queue.data.length === 0 ? (
          <p className="mt-2 text-sm">Nothing waiting for approval.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th scope="col" className={th}>
                  Consultant
                </th>
                <th scope="col" className={th}>
                  Week of
                </th>
                <th scope="col" className={th}>
                  Hours
                </th>
                <th scope="col" className={th}>
                  Submitted
                </th>
              </tr>
            </thead>
            <tbody>
              {queue.data.map((r) => (
                <tr key={r.timesheetId} className="border-b">
                  <th scope="row" className="py-2 pr-4 font-normal">
                    <Link href={`${base}/${r.timesheetId}`} className="underline underline-offset-4">
                      {r.consultantName}
                    </Link>
                  </th>
                  <td className="py-2 pr-4">{formatDayLabel(r.weekStart)}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.totalHours}</td>
                  <td className="py-2">{r.submittedAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="week-h" className="mt-10">
        <h2 id="week-h" className="text-lg font-medium">
          Week status
        </h2>
        <p className="mt-1 text-sm">Week of {formatDayLabel(weekStart)}</p>
        <p className="mt-2 flex gap-4 text-sm">
          <Link href={`${base}?week=${addDays(weekStart, -7)}`} className="underline underline-offset-4">
            Previous week
          </Link>
          {!isFutureWeek(nextWeek) && (
            <Link href={`${base}?week=${nextWeek}`} className="underline underline-offset-4">
              Next week
            </Link>
          )}
        </p>
        {!status.ok ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {status.error}
          </p>
        ) : status.data.length === 0 ? (
          <p className="mt-2 text-sm">No active consultants.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th scope="col" className={th}>
                  Consultant
                </th>
                <th scope="col" className={th}>
                  Status
                </th>
                <th scope="col" className={th}>
                  Hours
                </th>
                <th scope="col" className={th}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {status.data.map((r) => (
                <tr key={r.consultantId} className="border-b">
                  <th scope="row" className="py-2 pr-4 font-normal">
                    {r.timesheetId ? (
                      <Link href={`${base}/${r.timesheetId}`} className="underline underline-offset-4">
                        {r.consultantName}
                      </Link>
                    ) : (
                      r.consultantName
                    )}
                  </th>
                  <td className="py-2 pr-4">{STATUS_LABEL[r.status]}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.totalHours}</td>
                  <td className="py-2">
                    {!r.timesheetId && (
                      <Link
                        href={`/f/${firmId}/timesheet?consultant=${r.consultantId}&week=${weekStart}`}
                        className="underline underline-offset-4"
                      >
                        Enter time
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
