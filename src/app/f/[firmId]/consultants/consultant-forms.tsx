'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ConsultantType } from '@/lib/db-types'
import type { FormResult } from '@/lib/form'
import type { LoginOutcome } from '@/modules/consultants/data'
import {
  addCostRateAction,
  createConsultantAction,
  deleteCostRateAction,
  inviteConsultantAction,
  setConsultantActiveAction,
  updateConsultantAction,
} from '@/modules/consultants/actions'

const SELECT_CLASS = 'h-8 rounded-lg border border-input bg-background px-2 text-sm'
const TYPES: ConsultantType[] = ['employee', 'independent', 'vendor']

export type VendorOption = { id: string; name: string }
export type ConsultantFormValue = {
  id: string
  name: string
  email: string
  type: ConsultantType
  vendorId: string | null
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  )
}

function FormMessages({ state, success }: { state: FormResult<unknown> | null; success: string }) {
  return (
    <>
      {state && !state.ok && !state.fieldErrors && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm">
          {success}
        </p>
      )}
    </>
  )
}

export function ConsultantForm({
  firmId,
  vendors,
  consultant,
}: {
  firmId: string
  vendors: VendorOption[]
  consultant?: ConsultantFormValue
}) {
  const [type, setType] = useState<ConsultantType>(consultant?.type ?? 'employee')
  const [state, action, pending] = useActionState<FormResult<unknown> | null, FormData>(
    async (_prev, fd) => {
      // The vendor select is only rendered for vendor contractors; make the null explicit.
      if (fd.get('type') !== 'vendor') fd.set('vendorId', '')
      return consultant
        ? updateConsultantAction(firmId, consultant.id, fd)
        : createConsultantAction(firmId, fd)
    },
    null,
  )
  const fe = (state && !state.ok ? state.fieldErrors : undefined) ?? {}
  const described = (k: string) => (fe[k] ? `consultant-${k}-error` : undefined)

  return (
    <form action={action} className="mt-3 flex max-w-md flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="consultant-name">Name</Label>
        <Input
          id="consultant-name"
          name="name"
          defaultValue={consultant?.name ?? ''}
          required
          aria-invalid={!!fe.name}
          aria-describedby={described('name')}
        />
        <FieldError id="consultant-name-error" message={fe.name} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="consultant-email">Email</Label>
        <Input
          id="consultant-email"
          name="email"
          type="email"
          defaultValue={consultant?.email ?? ''}
          required
          aria-invalid={!!fe.email}
          aria-describedby={described('email')}
        />
        <FieldError id="consultant-email-error" message={fe.email} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="consultant-type">Type</Label>
        <select
          id="consultant-type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as ConsultantType)}
          className={SELECT_CLASS}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {type === 'vendor' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="consultant-vendor">Vendor</Label>
          <select
            id="consultant-vendor"
            name="vendorId"
            defaultValue={consultant?.vendorId ?? ''}
            aria-invalid={!!fe.vendorId}
            aria-describedby={described('vendorId')}
            className={SELECT_CLASS}
          >
            <option value="">Choose a vendor</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <FieldError id="consultant-vendorId-error" message={fe.vendorId} />
        </div>
      )}
      {!consultant && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="consultant-cost">Initial hourly cost (optional)</Label>
            <Input
              id="consultant-cost"
              name="initialHourlyCost"
              inputMode="decimal"
              aria-invalid={!!fe.initialHourlyCost}
              aria-describedby={described('initialHourlyCost')}
            />
            <FieldError id="consultant-initialHourlyCost-error" message={fe.initialHourlyCost} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="consultant-cost-from">Cost effective from</Label>
            <Input id="consultant-cost-from" name="initialCostFrom" type="date" />
          </div>
        </>
      )}
      <FormMessages state={state} success={consultant ? 'Consultant saved.' : 'Consultant added.'} />
      <Button type="submit" disabled={pending} className="self-start">
        {consultant ? (pending ? 'Saving…' : 'Save consultant') : pending ? 'Adding…' : 'Add consultant'}
      </Button>
    </form>
  )
}

export function ActiveForm({
  firmId,
  consultantId,
  active,
}: {
  firmId: string
  consultantId: string
  active: boolean
}) {
  const [state, action, pending] = useActionState<FormResult | null, FormData>(
    async () => setConsultantActiveAction(firmId, consultantId, !active),
    null,
  )
  return (
    <form action={action} className="flex items-center gap-2">
      <Button type="submit" variant="outline" disabled={pending}>
        {active ? 'Deactivate' : 'Reactivate'}
      </Button>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  )
}

const OUTCOME_MESSAGE: Record<LoginOutcome, string> = {
  linked: 'Linked to existing user.',
  invited: 'Invitation sent.',
  added: 'Existing user added to this firm.',
}

/** Stays mounted after success (when `hasLogin` flips to true) so the outcome message remains visible. */
export function InviteForm({
  firmId,
  consultantId,
  hasLogin,
}: {
  firmId: string
  consultantId: string
  hasLogin: boolean
}) {
  const [state, action, pending] = useActionState<FormResult<{ outcome: LoginOutcome }> | null, FormData>(
    async () => inviteConsultantAction(firmId, consultantId),
    null,
  )
  if (hasLogin && !state?.ok) return null
  return (
    <form action={action} className="flex flex-col gap-2">
      {!hasLogin && (
        <Button type="submit" variant="outline" disabled={pending} className="self-start">
          {pending ? 'Inviting…' : 'Invite to log in'}
        </Button>
      )}
      <FormMessages state={state} success={state?.ok ? OUTCOME_MESSAGE[state.data.outcome] : ''} />
    </form>
  )
}

export function CostRateForm({ firmId, consultantId }: { firmId: string; consultantId: string }) {
  const [state, action, pending] = useActionState<FormResult<unknown> | null, FormData>(
    async (_prev, fd) => addCostRateAction(firmId, consultantId, fd),
    null,
  )
  const fe = (state && !state.ok ? state.fieldErrors : undefined) ?? {}
  return (
    <form action={action} className="mt-3 flex max-w-md flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rate-cost">Hourly cost</Label>
        <Input
          id="rate-cost"
          name="hourlyCost"
          inputMode="decimal"
          required
          aria-invalid={!!fe.hourlyCost}
          aria-describedby={fe.hourlyCost ? 'rate-cost-error' : undefined}
        />
        <FieldError id="rate-cost-error" message={fe.hourlyCost} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rate-from">Effective from</Label>
        <Input
          id="rate-from"
          name="effectiveFrom"
          type="date"
          required
          aria-invalid={!!fe.effectiveFrom}
          aria-describedby={fe.effectiveFrom ? 'rate-from-error' : undefined}
        />
        <FieldError id="rate-from-error" message={fe.effectiveFrom} />
      </div>
      <FormMessages state={state} success="Cost rate added." />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Adding…' : 'Add cost rate'}
      </Button>
    </form>
  )
}

export function DeleteRateForm({
  firmId,
  consultantId,
  rateId,
  label,
}: {
  firmId: string
  consultantId: string
  rateId: string
  label: string
}) {
  const [state, action, pending] = useActionState<FormResult | null, FormData>(
    async () => deleteCostRateAction(firmId, consultantId, rateId),
    null,
  )
  return (
    <form action={action} className="flex items-center gap-2">
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        Delete<span className="sr-only"> cost rate {label}</span>
      </Button>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  )
}
