'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatMoney } from '@/lib/domain/money'
import { deleteManualLineAction, saveManualLineAction, setLineDescriptionAction } from '@/modules/invoices/actions'
import type { InvoiceLine } from '@/modules/invoices/data'
import { useRun } from './use-run'

const th = 'py-2 pr-4 font-medium'
const td = 'py-2 pr-4 align-top'

function TimeLineDescription({ firmId, invoiceId, line }: { firmId: string; invoiceId: string; line: InvoiceLine }) {
  const { pending, run, error } = useRun()
  const [value, setValue] = useState(line.description)
  const changed = value !== line.description
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        run(() => setLineDescriptionAction(firmId, invoiceId, line.id, fd))
      }}
    >
      <div className="flex gap-2">
        <Input
          name="description"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={`Line description ${line.consultantName ?? ''} ${line.projectName ?? ''}`.trim()}
        />
        {changed && (
          <Button type="submit" size="sm" disabled={pending}>
            Save
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

function ManualLineFields({
  idPrefix,
  line,
  errors,
}: {
  idPrefix: string
  line?: InvoiceLine
  errors: Partial<Record<string, string>>
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-desc`}>Description</Label>
        <Input
          id={`${idPrefix}-desc`}
          name="description"
          defaultValue={line?.description ?? ''}
          aria-invalid={!!errors.description}
          className="min-w-56"
        />
        {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-qty`}>Quantity</Label>
        <Input
          id={`${idPrefix}-qty`}
          name="quantity"
          inputMode="decimal"
          defaultValue={line?.quantity ?? ''}
          aria-invalid={!!errors.quantity}
          className="max-w-24"
        />
        {errors.quantity && <p className="text-xs text-destructive">{errors.quantity}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-price`}>Unit price</Label>
        <Input
          id={`${idPrefix}-price`}
          name="unitPrice"
          inputMode="decimal"
          defaultValue={line?.unitPrice ?? ''}
          aria-invalid={!!errors.unitPrice}
          className="max-w-32"
        />
        {errors.unitPrice && <p className="text-xs text-destructive">{errors.unitPrice}</p>}
      </div>
    </>
  )
}

function ManualLineForm({
  firmId,
  invoiceId,
  line,
  onDone,
}: {
  firmId: string
  invoiceId: string
  line?: InvoiceLine
  onDone?: () => void
}) {
  const { pending, run, errors, error } = useRun()
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const fd = new FormData(form)
        run(
          () => saveManualLineAction(firmId, invoiceId, line?.id ?? null, fd),
          () => {
            form.reset()
            onDone?.()
          },
        )
      }}
    >
      <ManualLineFields idPrefix={line ? `edit-${line.id}` : 'manual'} line={line} errors={errors} />
      <Button type="submit" variant={line ? 'default' : 'outline'} disabled={pending}>
        {line ? 'Save line' : 'Add line'}
      </Button>
      {line && (
        <Button type="button" variant="outline" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

function ManualLineRow({
  firmId,
  invoiceId,
  line,
  currency,
}: {
  firmId: string
  invoiceId: string
  line: InvoiceLine
  currency: string
}) {
  const { pending, run, error } = useRun()
  const [editing, setEditing] = useState(false)
  return (
    <>
      <tr className="border-b">
        <td className={td}></td>
        <td className={td}></td>
        <td className={td}>{line.description}</td>
        <td className={td}>{line.quantity}</td>
        <td className={td}>{formatMoney(line.unitPrice, currency)}</td>
        <td className={td}>{formatMoney(line.amount, currency)}</td>
        <td className={td}>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => deleteManualLineAction(firmId, invoiceId, line.id))}
            >
              Remove
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {error}
            </p>
          )}
        </td>
      </tr>
      {editing && (
        <tr className="border-b">
          <td colSpan={7} className="py-2">
            <ManualLineForm firmId={firmId} invoiceId={invoiceId} line={line} onDone={() => setEditing(false)} />
          </td>
        </tr>
      )}
    </>
  )
}

export function LinesTable({
  firmId,
  invoiceId,
  lines,
  currency,
}: {
  firmId: string
  invoiceId: string
  lines: InvoiceLine[]
  currency: string
}) {
  return (
    <section aria-labelledby="lines-h" className="mt-8">
      <h2 id="lines-h" className="text-lg font-medium">
        Lines
      </h2>
      <table className="mt-2 w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            {['Consultant', 'Project', 'Description', 'Quantity', 'Rate', 'Amount'].map((h) => (
              <th key={h} scope="col" className={th}>
                {h}
              </th>
            ))}
            <th scope="col" className={th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && (
            <tr>
              <td colSpan={7} className="py-2 text-muted-foreground">
                No lines yet.
              </td>
            </tr>
          )}
          {lines.map((l) =>
            l.kind === 'manual' ? (
              <ManualLineRow key={l.id} firmId={firmId} invoiceId={invoiceId} line={l} currency={currency} />
            ) : (
              <tr key={l.id} className="border-b">
                <td className={td}>{l.consultantName}</td>
                <td className={td}>{l.projectName}</td>
                <td className={td}>
                  <TimeLineDescription firmId={firmId} invoiceId={invoiceId} line={l} />
                </td>
                <td className={td}>{l.quantity}</td>
                <td className={td}>{formatMoney(l.unitPrice, currency)}</td>
                <td className={td}>{formatMoney(l.amount, currency)}</td>
                <td className={td}></td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      <h3 className="mt-6 text-sm font-medium">Add a manual line</h3>
      <div className="mt-2">
        <ManualLineForm firmId={firmId} invoiceId={invoiceId} />
      </div>
    </section>
  )
}
