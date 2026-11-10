'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FirmRole } from '@/lib/db-types'
import type { Result } from '@/lib/result'
import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
} from '@/modules/members/actions'

const ROLES: FirmRole[] = ['admin', 'manager', 'consultant']
const SELECT_CLASS = 'h-8 rounded-lg border border-input bg-card px-2 text-sm'

function ErrorLine({ state }: { state: Result<unknown> | null }) {
  if (!state || state.ok) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {state.error}
    </p>
  )
}

export function InviteForm({ firmId }: { firmId: string }) {
  const [state, action, pending] = useActionState<
    Result<{ userId: string; invited: boolean }> | null,
    FormData
  >(async (_prev, fd) => inviteMemberAction(firmId, fd), null)

  return (
    <form action={action} className="mt-3 flex max-w-md flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-email">Email</Label>
        <Input id="invite-email" name="email" type="email" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-role">Role</Label>
        <select id="invite-role" name="role" defaultValue="consultant" className={SELECT_CLASS}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <ErrorLine state={state} />
      {state?.ok && (
        <p role="status" className="text-sm">
          {state.data.invited ? 'Invitation sent.' : 'Existing user added to this firm.'}
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Inviting…' : 'Invite'}
      </Button>
    </form>
  )
}

export function RoleForm({
  firmId,
  userId,
  email,
  role,
}: {
  firmId: string
  userId: string
  email: string
  role: FirmRole
}) {
  const [state, action, pending] = useActionState<Result<void> | null, FormData>(
    async (_prev, fd) => changeMemberRoleAction(firmId, fd),
    null,
  )
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="role"
        defaultValue={role}
        aria-label={`Role for ${email}`}
        className={SELECT_CLASS}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Save
      </Button>
      <ErrorLine state={state} />
    </form>
  )
}

export function RemoveForm({
  firmId,
  userId,
  email,
}: {
  firmId: string
  userId: string
  email: string
}) {
  const [state, action, pending] = useActionState<Result<void> | null, FormData>(
    async (_prev, fd) => removeMemberAction(firmId, fd),
    null,
  )
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        Remove<span className="sr-only"> {email}</span>
      </Button>
      <ErrorLine state={state} />
    </form>
  )
}
