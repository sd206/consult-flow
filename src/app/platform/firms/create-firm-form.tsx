'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Result } from '@/lib/result'
import { createFirmAction } from '@/modules/firms/actions'

type State = Result<{ firmId: string }> | null

export function CreateFirmForm() {
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => createFirmAction(formData),
    null,
  )

  return (
    <form action={action} className="mt-3 flex max-w-md flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="firm-name">Firm name</Label>
        <Input id="firm-name" name="name" required maxLength={100} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="firm-admin-email">First Admin email</Label>
        <Input id="firm-admin-email" name="adminEmail" type="email" required />
      </div>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm">
          Firm created. The first Admin has been invited or added.
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Creating…' : 'Create firm'}
      </Button>
    </form>
  )
}
