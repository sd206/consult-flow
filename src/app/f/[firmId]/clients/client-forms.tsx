'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FormResult } from '@/lib/form'
import {
  createClientAction,
  deleteClientAction,
  setClientActiveAction,
  updateClientAction,
} from '@/modules/clients/actions'
import type { ClientRow } from '@/modules/clients/data'

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  )
}

export function ClientForm({ firmId, client }: { firmId: string; client?: ClientRow }) {
  const prefix = client ? `client-${client.id}` : 'client-new'
  const [state, action, pending] = useActionState<FormResult<unknown> | null, FormData>(
    async (_prev, fd) => (client ? updateClientAction(firmId, client.id, fd) : createClientAction(firmId, fd)),
    null,
  )
  const fe = (state && !state.ok ? state.fieldErrors : undefined) ?? {}

  const field = (name: string, label: string, value: string | null | undefined, type = 'text') => (
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
      {field('name', 'Client name', client?.name)}
      {field('billingContactName', 'Billing contact', client?.billingContactName)}
      {field('billingEmail', 'Billing email', client?.billingEmail, 'email')}
      {field('billingPhone', 'Billing phone', client?.billingPhone)}
      {field('billingAddress', 'Billing address', client?.billingAddress)}
      {state && !state.ok && !state.fieldErrors && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm">
          {client ? 'Client saved.' : 'Client added.'}
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {client ? (pending ? 'Saving…' : 'Save client') : pending ? 'Adding…' : 'Add client'}
      </Button>
    </form>
  )
}

export function ClientActiveForm({ firmId, client }: { firmId: string; client: ClientRow }) {
  const [state, action, pending] = useActionState<FormResult | null, FormData>(
    async () => setClientActiveAction(firmId, client.id, !client.active),
    null,
  )
  return (
    <form action={action} className="flex items-center gap-2">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {client.active ? 'Deactivate' : 'Reactivate'}
        <span className="sr-only"> {client.name}</span>
      </Button>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  )
}

export function DeleteClientForm({ firmId, client }: { firmId: string; client: ClientRow }) {
  const [state, action, pending] = useActionState<FormResult | null, FormData>(
    async () => deleteClientAction(firmId, client.id),
    null,
  )
  return (
    <form action={action} className="flex items-center gap-2">
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        Delete<span className="sr-only"> {client.name}</span>
      </Button>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  )
}
