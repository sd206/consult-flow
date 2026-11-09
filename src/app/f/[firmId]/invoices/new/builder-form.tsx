'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import type { FormResult } from '@/lib/form'
import { createDraftAction } from '@/modules/invoices/actions'
import type { Candidate } from '@/modules/invoices/data'

const th = 'py-2 pr-4 font-medium'
const td = 'py-2 pr-4'

export function BuilderForm({
  firmId,
  clientId,
  periodStart,
  periodEnd,
  templateId,
  candidates,
}: {
  firmId: string
  clientId: string
  periodStart: string
  periodEnd: string
  templateId: string
  candidates: Candidate[]
}) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<FormResult<unknown> | null>(null)
  const seen = new Set<string>()

  return (
    <form
      className="mt-6 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        // Every listed box ticked = all consultants (null): the draft then also picks up
        // consultants whose hours fall only in a later, wider period.
        const boxes = [...e.currentTarget.querySelectorAll<HTMLInputElement>('input[name="consultant"]')]
        if (boxes.every((b) => b.checked)) fd.set('allConsultants', '1')
        startTransition(async () => {
          // On success the action redirects to the new draft.
          setResult(await createDraftAction(firmId, fd))
        })
      }}
    >
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="periodStart" value={periodStart} />
      <input type="hidden" name="periodEnd" value={periodEnd} />
      <input type="hidden" name="templateId" value={templateId} />

      {candidates.length === 0 ? (
        <p className="text-sm">No approved, uninvoiced hours for this client in that period.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th scope="col" className={th}>
                Include
              </th>
              <th scope="col" className={th}>
                Consultant
              </th>
              <th scope="col" className={th}>
                Project
              </th>
              <th scope="col" className={th}>
                Rate
              </th>
              <th scope="col" className={th}>
                Hours
              </th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => {
              const first = !seen.has(c.consultantId)
              seen.add(c.consultantId)
              return (
                <tr key={`${c.consultantId}|${c.projectId}|${c.rate}`} className="border-b">
                  <td className={td}>
                    {first && (
                      <input
                        type="checkbox"
                        name="consultant"
                        value={c.consultantId}
                        defaultChecked
                        aria-label={`Include ${c.consultantName}`}
                      />
                    )}
                  </td>
                  <td className={td}>{c.consultantName}</td>
                  <td className={td}>{c.projectName}</td>
                  <td className={td}>{c.rate}</td>
                  <td className={td}>{c.hours}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {result && !result.ok && (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          Create draft
        </Button>
      </div>
    </form>
  )
}
