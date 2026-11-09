'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ProjectStatus } from '@/lib/db-types'
import type { FormResult } from '@/lib/form'
import {
  addAssignmentAction,
  changeClientRateAction,
  createProjectAction,
  endAssignmentAction,
  updateProjectAction,
} from '@/modules/projects/actions'

const SELECT_CLASS = 'h-8 rounded-lg border border-input bg-background px-2 text-sm'
const STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'closed', label: 'Closed' },
]

export type Option = { id: string; name: string }
export type ProjectFormValue = {
  id: string
  clientId: string
  name: string
  code: string | null
  status: ProjectStatus
  startDate: string | null
  endDate: string | null
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

const errorsOf = (state: FormResult<unknown> | null) => (state && !state.ok ? state.fieldErrors : undefined) ?? {}

export function ProjectForm({
  firmId,
  clients,
  project,
}: {
  firmId: string
  clients: Option[]
  project?: ProjectFormValue
}) {
  const prefix = project ? `project-${project.id}` : 'project-new'
  const [state, action, pending] = useActionState<FormResult<unknown> | null, FormData>(
    async (_prev, fd) => (project ? updateProjectAction(firmId, project.id, fd) : createProjectAction(firmId, fd)),
    null,
  )
  const fe = errorsOf(state)

  const text = (name: string, label: string, value: string | null | undefined, type = 'text') => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${prefix}-${name}`}>{label}</Label>
      <Input
        id={`${prefix}-${name}`}
        name={name}
        type={type}
        defaultValue={value ?? ''}
        required={name === 'name'}
        aria-invalid={!!fe[name]}
        aria-describedby={fe[name] ? `${prefix}-${name}-error` : undefined}
      />
      <FieldError id={`${prefix}-${name}-error`} message={fe[name]} />
    </div>
  )

  return (
    <form action={action} className="mt-3 flex max-w-md flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${prefix}-clientId`}>Client</Label>
        <select
          id={`${prefix}-clientId`}
          name="clientId"
          required
          defaultValue={project?.clientId ?? ''}
          className={SELECT_CLASS}
          aria-invalid={!!fe.clientId}
          aria-describedby={fe.clientId ? `${prefix}-clientId-error` : undefined}
        >
          <option value="" disabled>
            Choose a client
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <FieldError id={`${prefix}-clientId-error`} message={fe.clientId} />
      </div>
      {text('name', 'Project name', project?.name)}
      {text('code', 'Project code (optional)', project?.code)}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${prefix}-status`}>Status</Label>
        <select
          id={`${prefix}-status`}
          name="status"
          defaultValue={project?.status ?? 'active'}
          className={SELECT_CLASS}
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {text('startDate', 'Start date', project?.startDate, 'date')}
      {text('endDate', 'End date', project?.endDate, 'date')}
      <FormMessages state={state} success={project ? 'Project saved.' : 'Project added.'} />
      <Button type="submit" disabled={pending} className="self-start">
        {project ? (pending ? 'Saving…' : 'Save project') : pending ? 'Adding…' : 'Add project'}
      </Button>
    </form>
  )
}

export function AssignmentForm({
  firmId,
  projectId,
  consultants,
}: {
  firmId: string
  projectId: string
  consultants: Option[]
}) {
  const [state, action, pending] = useActionState<FormResult<unknown> | null, FormData>(
    async (_prev, fd) => addAssignmentAction(firmId, projectId, fd),
    null,
  )
  const fe = errorsOf(state)
  const input = (name: string, label: string, type: string, required = true, inputMode?: 'decimal') => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`assign-${name}`}>{label}</Label>
      <Input
        id={`assign-${name}`}
        name={name}
        type={type}
        inputMode={inputMode}
        required={required}
        aria-invalid={!!fe[name]}
        aria-describedby={fe[name] ? `assign-${name}-error` : undefined}
      />
      <FieldError id={`assign-${name}-error`} message={fe[name]} />
    </div>
  )

  return (
    <form action={action} className="mt-3 flex max-w-md flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assign-consultantId">Consultant</Label>
        <select
          id="assign-consultantId"
          name="consultantId"
          required
          defaultValue=""
          className={SELECT_CLASS}
          aria-invalid={!!fe.consultantId}
          aria-describedby={fe.consultantId ? 'assign-consultantId-error' : undefined}
        >
          <option value="" disabled>
            Choose a consultant
          </option>
          {consultants.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <FieldError id="assign-consultantId-error" message={fe.consultantId} />
      </div>
      {input('clientRate', 'Client rate (per hour)', 'text', true, 'decimal')}
      {input('effectiveFrom', 'Start date', 'date')}
      {input('effectiveTo', 'End date (optional)', 'date', false)}
      <FormMessages state={state} success="Consultant assigned." />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Assigning…' : 'Assign consultant'}
      </Button>
    </form>
  )
}

export function ChangeRateForm({
  firmId,
  projectId,
  assignmentId,
  label,
}: {
  firmId: string
  projectId: string
  assignmentId: string
  label: string
}) {
  const [state, action, pending] = useActionState<FormResult<unknown> | null, FormData>(
    async (_prev, fd) => changeClientRateAction(firmId, projectId, assignmentId, fd),
    null,
  )
  const fe = errorsOf(state)
  const id = (n: string) => `rate-${assignmentId}-${n}`
  return (
    <form action={action} className="mt-2 flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id('clientRate')}>New rate for {label}</Label>
        <Input
          id={id('clientRate')}
          name="clientRate"
          inputMode="decimal"
          required
          aria-invalid={!!fe.clientRate}
          aria-describedby={fe.clientRate ? id('clientRate-error') : undefined}
        />
        <FieldError id={id('clientRate-error')} message={fe.clientRate} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id('effectiveFrom')}>Starting</Label>
        <Input
          id={id('effectiveFrom')}
          name="effectiveFrom"
          type="date"
          required
          aria-invalid={!!fe.effectiveFrom}
          aria-describedby={fe.effectiveFrom ? id('effectiveFrom-error') : undefined}
        />
        <FieldError id={id('effectiveFrom-error')} message={fe.effectiveFrom} />
      </div>
      <FormMessages state={state} success="Rate changed." />
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {pending ? 'Changing…' : 'Change rate'}
      </Button>
    </form>
  )
}

export function EndAssignmentForm({
  firmId,
  projectId,
  assignmentId,
  label,
}: {
  firmId: string
  projectId: string
  assignmentId: string
  label: string
}) {
  const [state, action, pending] = useActionState<FormResult | null, FormData>(
    async (_prev, fd) => endAssignmentAction(firmId, projectId, assignmentId, fd),
    null,
  )
  const fe = errorsOf(state)
  const id = `end-${assignmentId}-effectiveTo`
  return (
    <form action={action} className="mt-2 flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>End {label} on</Label>
        <Input
          id={id}
          name="effectiveTo"
          type="date"
          required
          aria-invalid={!!fe.effectiveTo}
          aria-describedby={fe.effectiveTo ? `${id}-error` : undefined}
        />
        <FieldError id={`${id}-error`} message={fe.effectiveTo} />
      </div>
      <FormMessages state={state} success="Assignment ended." />
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="self-start">
        {pending ? 'Ending…' : 'End assignment'}
      </Button>
    </form>
  )
}
