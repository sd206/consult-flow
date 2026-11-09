'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Result } from '@/lib/result'
import {
  type SettingsResult,
  updateFirmSettingsAction,
  uploadFirmLogoAction,
} from '@/modules/firms/actions'
import type { Firm } from '@/modules/firms/data'

const SELECT_CLASS = 'h-8 rounded-lg border border-input bg-background px-2 text-sm'

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  )
}

export function LogoForm({ firmId, logoUrl }: { firmId: string; logoUrl: string | null }) {
  const [state, action, pending] = useActionState<Result<{ logoPath: string }> | null, FormData>(
    async (_prev, fd) => uploadFirmLogoAction(firmId, fd),
    null,
  )
  return (
    <form action={action} className="mt-3 flex flex-col gap-3">
      {logoUrl ? (
        // Rendered only via <img> so SVG content can never execute in the page.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="Firm logo" className="max-h-24 max-w-xs self-start rounded border" />
      ) : (
        <p className="text-sm text-muted-foreground">No logo uploaded.</p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="logo-file">Logo file (PNG, JPEG or SVG, up to 2 MB)</Label>
        <Input id="logo-file" name="logo" type="file" accept="image/png,image/jpeg,image/svg+xml" required />
      </div>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm">
          Logo updated.
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Uploading…' : 'Upload logo'}
      </Button>
    </form>
  )
}

export function SettingsForm({
  firmId,
  firm,
  currencies,
}: {
  firmId: string
  firm: Firm
  currencies: string[]
}) {
  const [state, action, pending] = useActionState<SettingsResult | null, FormData>(
    async (_prev, fd) => updateFirmSettingsAction(firmId, fd),
    null,
  )
  const fe = (state && !state.ok ? state.fieldErrors : undefined) ?? {}
  const err = (k: string) => (fe[k] ? `${k}-error` : undefined)

  const text = (id: string, label: string, value: string, type = 'text') => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} type={type} defaultValue={value} aria-invalid={!!fe[id]} aria-describedby={err(id)} />
      <FieldError id={`${id}-error`} message={fe[id]} />
    </div>
  )

  return (
    <form action={action} className="mt-3 flex flex-col gap-4">
      {text('name', 'Firm name', firm.name)}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Address</Label>
        <textarea
          id="address"
          name="address"
          rows={3}
          defaultValue={firm.address}
          aria-invalid={!!fe.address}
          aria-describedby={err('address')}
          className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm"
        />
        <FieldError id="address-error" message={fe.address} />
      </div>
      {text('contactName', 'Contact name', firm.contactName)}
      {text('contactEmail', 'Contact email', firm.contactEmail, 'email')}
      {text('contactPhone', 'Contact phone', firm.contactPhone)}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="currency">Currency</Label>
        <select
          id="currency"
          name="currency"
          defaultValue={firm.currency}
          aria-invalid={!!fe.currency}
          aria-describedby={err('currency')}
          className={SELECT_CLASS}
        >
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <FieldError id="currency-error" message={fe.currency} />
      </div>
      {text('defaultTaxPercent', 'Default tax percent', firm.defaultTaxPercent)}
      {text('defaultPaymentTermsDays', 'Default payment terms (days)', String(firm.defaultPaymentTermsDays))}
      {text('invoiceNumberPattern', 'Invoice number pattern', firm.invoiceNumberPattern)}

      {state && !state.ok && !state.fieldErrors && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm">
          Settings saved.
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Saving…' : 'Save settings'}
      </Button>
    </form>
  )
}
