'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FormResult } from '@/lib/form'
import { createVendorAction, deleteVendorAction, updateVendorAction } from '@/modules/vendors/actions'
import type { VendorRow } from '@/modules/vendors/data'

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  )
}

export function VendorForm({ firmId, vendor }: { firmId: string; vendor?: VendorRow }) {
  const prefix = vendor ? `vendor-${vendor.id}` : 'vendor-new'
  const [state, action, pending] = useActionState<FormResult<unknown> | null, FormData>(
    async (_prev, fd) =>
      vendor ? updateVendorAction(firmId, vendor.id, fd) : createVendorAction(firmId, fd),
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
      {field('name', 'Vendor name', vendor?.name)}
      {field('contactName', 'Contact name', vendor?.contactName)}
      {field('email', 'Contact email', vendor?.email, 'email')}
      {field('phone', 'Phone', vendor?.phone)}
      {field('address', 'Address', vendor?.address)}
      {state && !state.ok && !state.fieldErrors && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm">
          {vendor ? 'Vendor saved.' : 'Vendor added.'}
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {vendor ? (pending ? 'Saving…' : 'Save vendor') : pending ? 'Adding…' : 'Add vendor'}
      </Button>
    </form>
  )
}

export function DeleteVendorForm({ firmId, vendor }: { firmId: string; vendor: VendorRow }) {
  const [state, action, pending] = useActionState<FormResult | null, FormData>(
    async () => deleteVendorAction(firmId, vendor.id),
    null,
  )
  return (
    <form action={action} className="flex items-center gap-2">
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        Delete<span className="sr-only"> {vendor.name}</span>
      </Button>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  )
}
