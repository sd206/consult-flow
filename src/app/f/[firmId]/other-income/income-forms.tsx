'use client'

import { useState } from 'react'
import { askConfirm } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRun } from '@/components/use-run'
import { formatMoney } from '@/lib/domain/money'
import type { IncomeRow } from '@/modules/other-income/data'
import { createOtherIncomeAction, deleteOtherIncomeAction, updateOtherIncomeAction } from '@/modules/other-income/actions'

type Option = { id: string; name: string }
const select = 'h-8 rounded-lg border bg-card px-2 text-sm'
const td = 'py-2 pr-4 align-top'

function Fields({ idp, row, categories, errors, today }: { idp: string; row?: IncomeRow; categories: Option[]; errors: Partial<Record<string, string>>; today: string }) {
  const err = (k: string) => errors[k] && <p className="text-xs text-destructive">{errors[k]}</p>
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={`${idp}-date`}>Date</Label>
        <Input id={`${idp}-date`} name="receivedOn" type="date" max={today} defaultValue={row?.receivedOn ?? today} aria-invalid={!!errors.receivedOn} />
        {err('receivedOn')}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idp}-source`}>Received from</Label>
        <Input id={`${idp}-source`} name="source" defaultValue={row?.source} aria-invalid={!!errors.source} />
        {err('source')}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idp}-cat`}>Category</Label>
        <select id={`${idp}-cat`} name="categoryId" className={select} defaultValue={row?.categoryId ?? ''} aria-invalid={!!errors.categoryId}>
          <option value="">Choose…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {err('categoryId')}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idp}-amount`}>Amount</Label>
        <Input id={`${idp}-amount`} name="amount" inputMode="decimal" className="w-28" defaultValue={row?.amount} aria-invalid={!!errors.amount} />
        {err('amount')}
      </div>
      <div className="grid min-w-48 flex-1 gap-1.5">
        <Label htmlFor={`${idp}-notes`}>Notes (optional)</Label>
        <Input id={`${idp}-notes`} name="notes" maxLength={1000} defaultValue={row?.notes ?? ''} />
        {err('notes')}
      </div>
    </div>
  )
}

export function AddIncomeForm({ firmId, categories, today }: { firmId: string; categories: Option[]; today: string }) {
  const { pending, run, errors, error } = useRun()
  const [key, setKey] = useState(0)
  return (
    <form
      key={key}
      aria-label="Add other income"
      className="mt-4 grid gap-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        run(() => createOtherIncomeAction(firmId, fd), () => setKey((k) => k + 1))
      }}
    >
      <Fields idp="new" categories={categories} errors={errors} today={today} />
      <div>
        <Button type="submit" disabled={pending}>
          Add other income
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

export function IncomeTableRow({
  firmId,
  row,
  categories,
  currency,
  today,
}: {
  firmId: string
  row: IncomeRow
  categories: Option[]
  currency: string
  today: string
}) {
  const { pending, run, errors, error } = useRun()
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <tr className="border-b">
        <td colSpan={6} className="py-3">
          <form
            aria-label={`Edit ${row.source}`}
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              run(() => updateOtherIncomeAction(firmId, row.id, fd), () => setEditing(false))
            }}
          >
            <Fields idp={row.id} row={row} categories={categories} errors={errors} today={today} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                Save
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
        </td>
      </tr>
    )
  }
  return (
    <tr className="border-b">
      <td className={`${td} whitespace-nowrap`}>{row.receivedOn}</td>
      <th scope="row" className={`${td} font-normal`}>
        {row.source}
        {row.fromBank && <span className="ml-2 rounded border px-1 text-xs text-muted-foreground">from bank</span>}
      </th>
      <td className={td}>{row.categoryName}</td>
      <td className={`${td} text-right whitespace-nowrap`}>{formatMoney(row.amount, currency)}</td>
      <td className={`${td} whitespace-pre-line`}>{row.notes}</td>
      <td className={`${td} whitespace-nowrap text-right`}>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit<span className="sr-only"> {row.source}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              const msg = row.fromBank
                ? `Delete this entry of ${formatMoney(row.amount, currency)}? Its bank line goes back to review.`
                : `Delete this entry of ${formatMoney(row.amount, currency)}? This can't be undone.`
              if (await askConfirm(msg, { confirmLabel: 'Delete', destructive: true })) run(() => deleteOtherIncomeAction(firmId, row.id))
            }}
          >
            Delete<span className="sr-only"> {row.source}</span>
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-1 text-sm text-destructive">
            {error}
          </p>
        )}
      </td>
    </tr>
  )
}
