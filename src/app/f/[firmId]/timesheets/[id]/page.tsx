import { notFound } from 'next/navigation'
import { requireFirmRole } from '@/lib/auth/context'
import { sumHours } from '@/lib/domain/hours'
import { formatDayLabel, weekDays } from '@/lib/domain/weeks'
import { getTimesheetForReview } from '@/modules/timesheets/data'
import { STATUS_LABEL } from '../../timesheet/status-label'
import { ReviewActions } from './review-actions'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function TimesheetReviewPage({ params }: { params: Promise<{ firmId: string; id: string }> }) {
  const { firmId, id } = await params
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  if (!UUID_RE.test(id)) notFound()

  const res = await getTimesheetForReview(db, firmId, id)
  if (!res.ok) notFound()
  const t = res.data
  const days = weekDays(t.weekStart)
  const showRates = t.status === 'approved'
  const cell = (projectId: string, day: string) =>
    t.entries.find((e) => e.projectId === projectId && e.workDate === day)
  const rowEntries = (projectId: string) => t.entries.filter((e) => e.projectId === projectId)
  const rateOf = (projectId: string, key: 'clientRateSnapshot' | 'costRateSnapshot') => {
    const vals = [
      ...new Set(
        rowEntries(projectId)
          .map((e) => e[key])
          .filter((v): v is string => !!v),
      ),
    ]
    return vals.length > 0 ? vals.join(', ') : '—'
  }
  const editHref = `/f/${firmId}/timesheet?consultant=${t.consultantId}&week=${t.weekStart}`

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold">Timesheet: {t.consultantName}</h1>
      <h2 className="mt-1 text-lg font-medium">Week of {formatDayLabel(t.weekStart)}</h2>
      <p className="mt-2 text-sm">
        Status: <span data-testid="status">{STATUS_LABEL[t.status]}</span>
      </p>
      {t.status === 'rejected' && t.decisionComment && (
        <div className="mt-3 rounded-lg border p-3 text-sm">
          <p className="font-medium">Changes requested:</p>
          <p>{t.decisionComment}</p>
        </div>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="p-2">
                Project
              </th>
              {days.map((d) => (
                <th key={d} scope="col" className="p-2 font-medium">
                  {formatDayLabel(d)}
                </th>
              ))}
              <th scope="col" className="p-2">
                Total
              </th>
              {showRates && (
                <>
                  <th scope="col" className="p-2">
                    Client rate
                  </th>
                  <th scope="col" className="p-2">
                    Cost rate
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {t.projects.map((p) => (
              <tr key={p.projectId} className="border-b align-top">
                <th scope="row" className="p-2 text-left font-medium">
                  {p.projectName} · {p.clientName}
                </th>
                {days.map((d) => {
                  const e = cell(p.projectId, d)
                  return (
                    <td key={d} className="p-2">
                      {e && (
                        <>
                          <span className="tabular-nums">{e.hours}</span>
                          {e.note && <span className="block text-xs text-muted-foreground">{e.note}</span>}
                        </>
                      )}
                    </td>
                  )
                })}
                <td className="p-2 tabular-nums">{sumHours(rowEntries(p.projectId).map((e) => e.hours))}</td>
                {showRates && (
                  <>
                    <td className="p-2 tabular-nums">{rateOf(p.projectId, 'clientRateSnapshot')}</td>
                    <td className="p-2 tabular-nums">{rateOf(p.projectId, 'costRateSnapshot')}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="p-2 text-left">
                Day total
              </th>
              {days.map((d) => (
                <td key={d} className="p-2 tabular-nums">
                  {sumHours(t.entries.filter((e) => e.workDate === d).map((e) => e.hours))}
                </td>
              ))}
              <td className="p-2 font-medium tabular-nums" data-testid="week-total">
                {t.totalHours}
              </td>
              {showRates && <td colSpan={2} />}
            </tr>
          </tfoot>
        </table>
      </div>

      <ReviewActions
        firmId={firmId}
        timesheetId={t.timesheetId}
        status={t.status as Exclude<typeof t.status, 'not_started'>}
        editHref={editHref}
      />
    </div>
  )
}
