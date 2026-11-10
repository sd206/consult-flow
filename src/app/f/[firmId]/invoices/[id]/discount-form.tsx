'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setDiscountAction } from '@/modules/invoices/actions'
import type { InvoiceDetail } from '@/modules/invoices/data'
import { useRun } from '@/components/use-run'

export function DiscountForm({ firmId, invoice }: { firmId: string; invoice: InvoiceDetail }) {
  const { pending, run, errors, error } = useRun()
  return (
    <form
      className="mt-6 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        run(() => setDiscountAction(firmId, invoice.id, fd))
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="disc-type">Discount</Label>
        <select
          id="disc-type"
          name="type"
          defaultValue={invoice.discountType}
          className="h-8 rounded-lg border bg-background px-2 text-sm"
        >
          <option value="none">No discount</option>
          <option value="percent">Percentage</option>
          <option value="amount">Fixed amount</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="disc-value">Discount value</Label>
        <Input
          id="disc-value"
          name="value"
          inputMode="decimal"
          defaultValue={invoice.discountType === 'none' ? '' : invoice.discountValue}
          aria-invalid={!!errors.value}
          className="max-w-32"
        />
        {errors.value && <p className="text-xs text-destructive">{errors.value}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="disc-label">Discount label</Label>
        <Input
          id="disc-label"
          name="label"
          defaultValue={invoice.discountLabel ?? ''}
          aria-invalid={!!errors.label}
          className="max-w-48"
        />
        {errors.label && <p className="text-xs text-destructive">{errors.label}</p>}
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Save discount
      </Button>
      {error && !errors.value && !errors.label && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
