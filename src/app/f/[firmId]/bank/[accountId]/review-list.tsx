'use client'

import { Fragment, useState } from 'react'
import { askConfirm } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRun } from '@/components/use-run'
import { formatMoney } from '@/lib/domain/money'
import {
  bulkCategoriseAction,
  confirmSuggestedAction,
  ignoreLinesAction,
  markDuplicatesAction,
  resetLineAction,
} from '@/modules/bank/actions'
import { filterLines, type Direction } from '@/modules/bank/filter'
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
  const [text, setText] = useState('')
  const [direction, setDirection] = useState<Direction>('all')
  const [expenseCat, setExpenseCat] = useState('')
  const [incomeCat, setIncomeCat] = useState('')
  const [bulkClient, setBulkClient] = useState('')
  const [bulkProject, setBulkProject] = useState('')
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const incomeName = new Map(incomeCategories.map((c) => [c.id, c.name]))

  if (lines.length === 0) {
    return (
      <>
        {notice && (
          <p role="status" aria-label="Bulk result" className="mt-4 text-sm">
            {notice}
          </p>
        )}
        <p className="mt-6 text-sm">
          {status === 'new' ? 'Nothing to review. Upload a statement to bring in new lines.' : 'No lines here yet.'}
        </p>
      </>
    )
  }

  const visible = status === 'new' ? filterLines(lines, text, direction) : lines
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  // Only lines on screen count, so a filter change never acts on hidden lines.
  const chosen = visible.filter((l) => selected.has(l.id))
  const chosenOut = chosen.filter((l) => l.amount.startsWith('-'))
  const chosenIn = chosen.filter((l) => !l.amount.startsWith('-'))
  const allChosen = visible.length > 0 && chosen.length === visible.length
  const suggestable = chosenOut.filter((l) => l.suggestedCategoryId && categoryName.has(l.suggestedCategoryId))
  const canCategorise =
    chosen.length > 0 && (chosenOut.length === 0 || expenseCat !== '') && (chosenIn.length === 0 || incomeCat !== '')
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  const done = (msg: string) => {
    setNotice(msg)
    setSelected(new Set())
  }
  const summary = (r: { recorded: number; failed: number; reasons: string[] }) =>
    `${plural(r.recorded, 'line')} recorded.${r.failed ? ` ${plural(r.failed, 'line')} couldn't be recorded and stayed in review: ${r.reasons.join(' ')}` : ''}`
  const money = (v: string) => (
    <span className={v.startsWith('-') ? 'text-red-700 dark:text-red-400' : undefined}>{formatMoney(v, currency)}</span>
  )
  const select = 'h-7 rounded-lg border bg-card px-2 text-sm'

  return (
    <div className="mt-4">
      {status === 'new' && (
        <>
          <div className="flex flex-wrap items-end gap-3 text-sm" role="search" aria-label="Filter lines">
            <div className="grid gap-1">
              <label htmlFor="bl-filter">Filter</label>
              <Input id="bl-filter" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. uber" className="h-8 w-56" />
            </div>
            <div className="grid gap-1">
              <label htmlFor="bl-direction">Show</label>
              <select
                id="bl-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as Direction)}
                className={`${select} h-8`}
              >
                <option value="all">Money in and out</option>
                <option value="in">Money in only</option>
                <option value="out">Money out only</option>
              </select>
            </div>
            <span className="pb-1.5 text-muted-foreground">
              Showing {visible.length} of {lines.length}
            </span>
          </div>

          <div className="mt-3 grid gap-3 rounded-xl border bg-card p-3 text-sm" aria-label="Bulk actions" role="group">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{chosen.length} selected</span>
              {chosen.length > 0 && (
                <span className="text-muted-foreground">
                  ({plural(chosenOut.length, 'money out', 'money out')}, {plural(chosenIn.length, 'money in', 'money in')})
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              {chosenOut.length > 0 && (
                <>
                  <div className="grid gap-1">
                    <label htmlFor="bulk-exp-cat">Expense category</label>
                    <select id="bulk-exp-cat" value={expenseCat} onChange={(e) => setExpenseCat(e.target.value)} className={select}>
                      <option value="">Choose…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <label htmlFor="bulk-client">Client (optional)</label>
                    <select
                      id="bulk-client"
                      value={bulkClient}
                      onChange={(e) => {
                        setBulkClient(e.target.value)
                        setBulkProject('')
                      }}
                      className={select}
                    >
                      <option value="">None</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <label htmlFor="bulk-project">Project (optional)</label>
                    <select id="bulk-project" value={bulkProject} onChange={(e) => setBulkProject(e.target.value)} className={select}>
                      <option value="">None</option>
                      {projects
                        .filter((p) => !bulkClient || p.clientId === bulkClient)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </>
              )}
              {chosenIn.length > 0 && (
                <div className="grid gap-1">
                  <label htmlFor="bulk-inc-cat">Other income category</label>
                  <select id="bulk-inc-cat" value={incomeCat} onChange={(e) => setIncomeCat(e.target.value)} className={select}>
                    <option value="">Choose…</option>
                    {incomeCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Button
                type="button"
                size="sm"
                disabled={pending || !canCategorise}
                onClick={async () => {
                  const parts = [
                    chosenOut.length ? `${plural(chosenOut.length, 'line')} as expenses in ${categoryName.get(expenseCat)}` : '',
                    chosenIn.length ? `${plural(chosenIn.length, 'line')} as other income in ${incomeName.get(incomeCat)}` : '',
                  ].filter(Boolean)
                  if (!(await askConfirm(`Record ${parts.join(' and ')}?`, { confirmLabel: 'Record' }))) return
                  run(async () => {
                    const r = await bulkCategoriseAction(firmId, accountId, {
                      expenseLineIds: chosenOut.map((l) => l.id),
                      expenseCategoryId: expenseCat,
                      clientId: bulkClient,
                      projectId: bulkProject,
                      incomeLineIds: chosenIn.map((l) => l.id),
                      incomeCategoryId: incomeCat,
                    })
                    if (r.ok) done(summary(r.data))
                    return r.ok ? { ok: true, data: undefined } : r
                  })
                }}
              >
                Categorise selected
              </Button>
            </div>

            <div className="flex flex-wrap items-end gap-2 border-t pt-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || suggestable.length === 0}
                onClick={async () => {
                  const ok = await askConfirm(`Record ${plural(suggestable.length, 'line')} as expenses with their suggested categories?`, {
                    confirmLabel: 'Record',
                  })
                  if (!ok) return
                  run(async () => {
                    const r = await confirmSuggestedAction(
                      firmId,
                      accountId,
                      suggestable.map((l) => ({ lineId: l.id, categoryId: l.suggestedCategoryId! })),
                    )
                    if (r.ok) done(summary(r.data))
                    return r.ok ? { ok: true, data: undefined } : r
                  })
                }}
              >
                Confirm suggested ({suggestable.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || chosen.length === 0}
                onClick={async () => {
                  const ok = await askConfirm(
                    `Mark ${plural(chosen.length, 'line')} as duplicates? Each is matched to the one entry already recorded with the same amount within 7 days; lines with no single match are ignored as "Duplicate".`,
                    { confirmLabel: 'Mark as duplicate' },
                  )
                  if (!ok) return
                  run(async () => {
                    const r = await markDuplicatesAction(firmId, accountId, chosen.map((l) => l.id))
                    if (r.ok) {
                      const skipped = r.data.skipped ? ` ${plural(r.data.skipped, 'line')} had already been handled.` : ''
                      done(
                        `${plural(r.data.matched, 'line')} matched to existing entries, ${plural(r.data.ignored, 'line')} ignored as duplicates.${skipped}`,
                      )
                    }
                    return r.ok ? { ok: true, data: undefined } : r
                  })
                }}
              >
                Mark as duplicate
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
                  if (!(await askConfirm(`Ignore ${plural(chosen.length, 'line')}? You can undo this later.`, { confirmLabel: 'Ignore' }))) return
                  run(async () => {
                    const r = await ignoreLinesAction(firmId, accountId, chosen.map((l) => l.id), reason)
                    if (r.ok) {
                      done(`${plural(r.data, 'line')} ignored.`)
                      setReason('')
                    }
                    return r.ok ? { ok: true, data: undefined } : r
                  })
                }}
              >
                Ignore selected
              </Button>
            </div>
          </div>
        </>
      )}
      {notice && (
        <p role="status" aria-label="Bulk result" className="mt-2 text-sm">
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
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={allChosen}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s)
                        for (const l of visible) {
                          if (allChosen) n.delete(l.id)
                          else n.add(l.id)
                        }
                        return n
                      })
                    }
                  />
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
            {visible.map((l) => (
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
