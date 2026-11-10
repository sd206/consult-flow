'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { FormResult } from '@/lib/form'
import { approveAction, rejectAction, reopenAction } from '@/modules/timesheets/actions'

export function ReviewActions({
  firmId,
  timesheetId,
  status,
  editHref,
}: {
  firmId: string
  timesheetId: string
  status: 'draft' | 'submitted' | 'approved' | 'rejected'
  editHref: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<FormResult | null>(null)

  const run = (fn: () => Promise<FormResult>) =>
    startTransition(async () => {
      const r = await fn()
      setResult(r)
      if (r.ok) router.refresh()
    })

  const commentError = result && !result.ok ? result.fieldErrors?.comment : undefined

  return (
    <div className="mt-6 flex flex-col gap-4">
      {status === 'submitted' && (
        <>
          <div>
            <Button type="button" disabled={pending} onClick={() => run(() => approveAction(firmId, timesheetId))}>
              Approve
            </Button>
          </div>
          <form
            className="flex max-w-md flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              run(() => rejectAction(firmId, timesheetId, fd))
            }}
          >
            <Label htmlFor="reject-comment">What needs to change?</Label>
            <textarea
              id="reject-comment"
              name="comment"
              required
              rows={3}
              aria-invalid={!!commentError}
              className="rounded-md border bg-card p-2 text-sm"
            />
            {commentError && <p className="text-xs text-destructive">{commentError}</p>}
            <div>
              <Button type="submit" variant="outline" disabled={pending}>
                Reject
              </Button>
            </div>
          </form>
        </>
      )}
      {status === 'approved' && (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => reopenAction(firmId, timesheetId))}
          >
            Reopen
          </Button>
        </div>
      )}
      {(status === 'draft' || status === 'rejected') && (
        <Link href={editHref} className="text-sm underline underline-offset-4">
          Edit on their behalf
        </Link>
      )}
      {result && !result.ok && (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      )}
    </div>
  )
}
