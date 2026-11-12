'use client'

import { Fragment, useState } from 'react'
import { askConfirm } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRun } from '@/components/use-run'
import { formatMoney } from '@/lib/domain/money'
import { confirmSuggestedAction, ignoreLinesAction, resetLineAction } from '@/modules/bank/actions'
import type { BankLine, LineStatus } from '@/modules/bank/data'
import { LineActions, type Option, type ProjectOption } from './line-actions'

const th = 'py-2 pr-4 font-medium'
const td = 'py-2 pr-4 align-top'

const LINK_LABEL = { payment: 'Invoice payment', expense: 'Expense', other_income: 'Other income' } as const

export function ReviewList({
  firmId,
  accountId,
  status,
  currency,
  lines,
  categories,
  incomeCategories,
  clients,
  projects,
}: {
  firmId: string
  accountId: string
  status: LineStatus
  currency: string
  lines: BankLine[]
  categories: Option[]
  incomeCategories: Option[]
  clients: Option[]
  projects: ProjectOption[]
}) {
  const { pending, run, error } = useRun()
  const [open, setOpen] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))

  if (lines.length === 0) {
    return (
      <p className="mt-6 text-sm">
        {status === 'new' ? 'Nothing to review. Upload a statement to bring in new lines.' : 'No lines here yet.'}
      </p>
    )
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const chosen = lines.filter((l) => selected.has(l.id))
  const suggestable = chosen.filter((l) => l.amount.startsWith('-') && l.suggestedCategoryId && categoryName.has(l.suggestedCategoryId))
  const money = (v: string) => (
    <span className={v.startsWith('-') ? 'text-red-700 dark:text-red-400' : undefined}>{formatMoney(v, currency)}</span>
  )

  return (
    <div className="mt-4">
      {status === 'new' && (
        <div className="flex flex-wrap items-end gap-2 text-sm" aria-label="Bulk actions" role="group">
          <span className="pb-1.5">{chosen.length} selected</span>
          <Button
            type="button"
            size="sm"
            disabled={pending || suggestable.length === 0}
            onClick={() =>
              run(async () => {
                const r = await confirmSuggestedAction(
                  firmId,
                  accountId,
                  suggestable.map((l) => ({ lineId: l.id, payee: l.description.slice(0, 200), categoryId: l.suggestedCategoryId! })),
                )
                if (r.ok) {
                  setNotice(
                    `${r.data.confirmed} confirmed as expenses${r.data.failed ? `, ${r.data.failed} couldn't be confirmed` : ''}.`,
                  )
                  setSelected(new Set())
                }
                return r.ok ? { ok: true, data: undefined } : r
              })
            }
          >
            Confirm suggested ({suggestable.length})
          </Button>
          <Input
            aria-label="Reason for ignoring"
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-7 w-48"
            maxLength={200}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || chosen.length === 0}
            onClick={async () => {
              if (!(await askConfirm(`Ignore ${chosen.length} ${chosen.length === 1 ? 'line' : 'lines'}? You can undo this later.`, { confirmLabel: 'Ignore' }))) return
              run(async () => {
                const r = await ignoreLinesAction(firmId, accountId, [...selected], reason)
                if (r.ok) {
                  setSelected(new Set())
                  setReason('')
                }
                return r.ok ? { ok: true, data: undefined } : r
              })
            }}
          >
            Ignore selected
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="mt-2 text-sm">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              {status === 'new' && (
                <th scope="col" className={th}>
                  <span className="sr-only">Select</span>
                </th>
              )}
              <th scope="col" className={th}>Date</th>
              <th scope="col" className={th}>Description</th>
              <th scope="col" className={`${th} text-right`}>Amount</th>
              <th scope="col" className={th}>{status === 'new' ? 'Suggestion' : status === 'done' ? 'Recorded as' : 'Reason'}</th>
              <th scope="col" className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              renderRow(l)
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  function renderRow(l: BankLine) {
    const isOpen = open === l.id
    const cols = status === 'new' ? 6 : 5
    return (
      <Fragment key={l.id}>
        <tr className="border-b" data-line={l.id}>
          {status === 'new' && (
            <td className={td}>
              <input
                type="checkbox"
                aria-label={`Select ${l.description}`}
                checked={selected.has(l.id)}
                onChange={() => toggle(l.id)}
              />
            </td>
          )}
          <td className={`${td} whitespace-nowrap`}>{l.postedOn}</td>
          <th scope="row" className={`${td} font-normal`}>
            {l.description}
          </th>
          <td className={`${td} whitespace-nowrap text-right`}>{money(l.amount)}</td>
          <td className={td}>
            {status === 'new'
              ? l.suggestedCategoryId && categoryName.has(l.suggestedCategoryId)
                ? `Expense: ${categoryName.get(l.suggestedCategoryId)}`
                : ''
              : status === 'done'
                ? `${l.linkKind ? LINK_LABEL[l.linkKind] : ''}${l.linkedLabel ? ` – ${l.linkedLabel}` : ''}`
                : (l.ignoreReason ?? '')}
          </td>
          <td className={`${td} whitespace-nowrap text-right`}>
            {status === 'new' ? (
              <Button type="button" size="sm" variant={isOpen ? 'outline' : 'default'} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : l.id)}>
                {isOpen ? 'Close' : 'Review'}
                <span className="sr-only"> {l.description}</span>
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={async () => {
                  const msg =
                    status === 'done'
                      ? 'Move this line back to review? The recorded entry stays; delete it from its own page if it was wrong.'
                      : 'Move this line back to review?'
                  if (await askConfirm(msg, { confirmLabel: 'Undo' })) run(() => resetLineAction(firmId, accountId, l.id))
                }}
              >
                Undo<span className="sr-only"> {l.description}</span>
              </Button>
            )}
          </td>
        </tr>
        {isOpen && (
          <tr className="border-b bg-selected">
            <td colSpan={cols} className="p-3">
              <LineActions
                firmId={firmId}
                accountId={accountId}
                line={l}
                categories={categories}
                incomeCategories={incomeCategories}
                clients={clients}
                projects={projects}
                currency={currency}
                onDone={() => setOpen((o) => (o === l.id ? null : o))}
              />
            </td>
          </tr>
        )}
      </Fragment>
    )
  }
}
