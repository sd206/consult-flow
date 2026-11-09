'use client'

import { useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseHours, sumHours } from '@/lib/domain/hours'
import { formatDayLabel, weekDays } from '@/lib/domain/weeks'
import type { FormResult } from '@/lib/form'
import { saveWeekAction, submitWeekAction } from '@/modules/timesheets/actions'

type GridProject = { projectId: string; projectName: string; clientName: string; activeDays: string[] }
type GridEntry = { projectId: string; workDate: string; hours: string; note: string | null }
type Cell = { h: string; n: string }

const key = (projectId: string, day: string) => `${projectId}:${day}`

export function WeekGrid({
  firmId,
  consultantId,
  weekStart,
  projects,
  entries,
  editable,
}: {
  firmId: string
  consultantId: string
  weekStart: string
  projects: GridProject[]
  entries: GridEntry[]
  editable: boolean
}) {
  const days = weekDays(weekStart)
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<FormResult<unknown> | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [cells, setCells] = useState<Record<string, Cell>>(() => {
    const init: Record<string, Cell> = {}
    for (const e of entries) init[key(e.projectId, e.workDate)] = { h: e.hours, n: e.note ?? '' }
    return init
  })

  if (projects.length === 0) return <p className="mt-6">No projects assigned for this week.</p>

  const isActive = (p: GridProject, day: string) => p.activeDays.includes(day)
  const staleExists = entries.some((e) => {
    const p = projects.find((x) => x.projectId === e.projectId)
    return !p || !isActive(p, e.workDate)
  })
  // Hours that will be dropped on save are not counted while the week is editable.
  const counted = (p: GridProject, day: string): string[] => {
    if (editable && !isActive(p, day)) return []
    const c = cells[key(p.projectId, day)]
    if (!c || c.h.trim() === '') return []
    const parsed = parseHours(c.h)
    return parsed.ok ? [parsed.data] : []
  }
  const rowTotal = (p: GridProject) => sumHours(days.flatMap((d) => counted(p, d)))
  const dayTotal = (d: string) => sumHours(projects.flatMap((p) => counted(p, d)))
  const weekTotal = sumHours(projects.flatMap((p) => days.flatMap((d) => counted(p, d))))

  const setCell = (k: string, patch: Partial<Cell>) =>
    setCells((prev) => ({ ...prev, [k]: { ...(prev[k] ?? { h: '', n: '' }), ...patch } }))

  const run = (kind: 'save' | 'submit') => {
    if (!formRef.current) return
    const fd = new FormData(formRef.current)
    setSaved(null)
    startTransition(async () => {
      const r =
        kind === 'save'
          ? await saveWeekAction(firmId, consultantId, weekStart, fd)
          : await submitWeekAction(firmId, consultantId, weekStart, fd)
      setResult(r)
      if (r.ok) setSaved(kind === 'save' ? 'Saved.' : 'Submitted.')
    })
  }

  const fe = (result && !result.ok ? result.fieldErrors : undefined) ?? {}

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="mt-6 flex flex-col gap-4">
      {editable && staleExists && (
        <p className="rounded-lg border p-3 text-sm">
          Hours on days you&apos;re no longer assigned to will be removed when you save.
        </p>
      )}
      <div className="overflow-x-auto">
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
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.projectId} className="border-b align-top">
                <th scope="row" className="p-2 text-left font-medium">
                  {p.projectName} · {p.clientName}
                </th>
                {days.map((d) => {
                  const k = key(p.projectId, d)
                  const c = cells[k] ?? { h: '', n: '' }
                  const disabled = editable && !isActive(p, d)
                  const label = `${p.projectName} ${formatDayLabel(d)}`
                  const err = fe[`h:${p.projectId}:${d}`]
                  const nerr = fe[`n:${p.projectId}:${d}`]
                  return (
                    <td key={d} className="p-1">
                      <div className="flex flex-col gap-1">
                        <Input
                          name={`h:${p.projectId}:${d}`}
                          type="text"
                          inputMode="decimal"
                          aria-label={`Hours ${label}`}
                          aria-invalid={!!err}
                          className="w-20"
                          value={c.h}
                          disabled={disabled}
                          readOnly={!editable}
                          onChange={(e) => setCell(k, { h: e.target.value })}
                        />
                        <Input
                          name={`n:${p.projectId}:${d}`}
                          type="text"
                          aria-label={`Note ${label}`}
                          aria-invalid={!!nerr}
                          className="w-28"
                          value={c.n}
                          disabled={disabled}
                          readOnly={!editable}
                          onChange={(e) => setCell(k, { n: e.target.value })}
                        />
                        {err && <p className="max-w-28 text-xs text-destructive">{err}</p>}
                        {nerr && <p className="max-w-28 text-xs text-destructive">{nerr}</p>}
                      </div>
                    </td>
                  )
                })}
                <td className="p-2 tabular-nums">{rowTotal(p)}</td>
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
                  {dayTotal(d)}
                </td>
              ))}
              <td className="p-2 font-medium tabular-nums" data-testid="week-total">
                {weekTotal}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {result && !result.ok && (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm">
          {saved}
        </p>
      )}
      {editable && (
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => run('save')}>
            Save draft
          </Button>
          <Button type="button" disabled={pending} onClick={() => run('submit')}>
            Submit
          </Button>
        </div>
      )}
    </form>
  )
}
