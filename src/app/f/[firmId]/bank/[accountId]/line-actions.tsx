'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRun } from '@/components/use-run'
import { formatMoney } from '@/lib/domain/money'
import {
  candidatesAction,
  confirmExpenseAction,
  confirmOtherIncomeAction,
  confirmPaymentAction,
  ignoreLinesAction,
  linkLineAction,
} from '@/modules/bank/actions'
import type { BankLine, Candidates } from '@/modules/bank/data'
import { payeeFromDescription } from '@/modules/bank/filter'

export type Option = { id: string; name: string }
export type ProjectOption = { id: string; name: string; clientId: string }

type Mode = 'payment' | 'other_income' | 'expense' | 'existing' | 'ignore'

const select = 'h-8 w-full rounded-lg border bg-card px-2 text-sm'


export function LineActions({
  firmId,
  accountId,
  line,
  categories,
  incomeCategories,
  clients,
  projects,
  currency,
  onDone,
}: {
  firmId: string
  accountId: string
  line: BankLine
  categories: Option[]
  incomeCategories: Option[]
  clients: Option[]
  projects: ProjectOption[]
  currency: string
  onDone: () => void
}) {
  const moneyIn = !line.amount.startsWith('-')
  const [cand, setCand] = useState<Candidates | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(moneyIn ? 'payment' : 'expense')
  const [chosenExisting, setChosenExisting] = useState(false)
  const { pending, run, errors, error } = useRun()
  const [clientId, setClientId] = useState('')

  useEffect(() => {
    let live = true
    candidatesAction(firmId, { id: line.id, description: line.description, amount: line.amount })
      .then((r) => {
        if (!live) return
        if (!r.ok) setLoadError(r.error)
        else {
          setCand(r.data)
          const existing = moneyIn ? r.data.payments.length : r.data.expenses.length
          if (existing > 0 && !chosenExisting) {
            setMode('existing')
            setChosenExisting(true)
          }
        }
      })
      .catch(() => live && setLoadError('Something went wrong. Please try again.'))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmId, line.id])

  const modes: { id: Mode; label: string }[] = moneyIn
    ? [
        { id: 'payment', label: 'Invoice payment' },
        { id: 'other_income', label: 'Other income' },
        { id: 'existing', label: 'Already entered' },
        { id: 'ignore', label: 'Ignore' },
      ]
    : [
        { id: 'expense', label: 'Expense' },
        { id: 'existing', label: 'Already entered' },
        { id: 'ignore', label: 'Ignore' },
      ]
  const absAmount = line.amount.replace(/^-/, '')
  const submit = (fn: (fd: FormData) => ReturnType<typeof confirmPaymentAction>) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    run(() => fn(fd), onDone)
  }

  return (
    <div className="grid gap-3 text-sm" aria-label={`Review ${line.description}`} role="group">
      <fieldset className="flex flex-wrap gap-3">
        <legend className="sr-only">Record this line as</legend>
        {modes.map((m) => (
          <label key={m.id} className="flex items-center gap-1.5">
            <input type="radio" name={`mode-${line.id}`} checked={mode === m.id} onChange={() => setMode(m.id)} />
            {m.label}
          </label>
        ))}
      </fieldset>

      {loadError && (
        <p role="alert" className="text-destructive">
          {loadError}
        </p>
      )}

      {mode === 'payment' && (
        <form aria-label="Invoice payment" className="grid max-w-xl gap-3" onSubmit={submit((fd) => confirmPaymentAction(firmId, accountId, line.id, fd))}>
          {!cand ? (
            <p>Loading open invoices…</p>
          ) : cand.invoices.length === 0 ? (
            <p>There are no open invoices. Record this as other income, or issue the invoice first.</p>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor={`inv-${line.id}`}>Invoice</Label>
              <select id={`inv-${line.id}`} name="invoiceId" className={select} defaultValue={cand.invoices[0].id}>
                {cand.invoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} · {i.client_name} · {formatMoney(i.balance_due, currency)} due
                    {Number(i.balance_due) === Number(absAmount) ? ' (exact match)' : ''}
                  </option>
                ))}
              </select>
              {errors.invoiceId && <p className="text-xs text-destructive">{errors.invoiceId}</p>}
            </div>
          )}
          <Notes id={`pn-${line.id}`} error={errors.notes} />
          <div>
            <Button type="submit" disabled={pending || !cand || cand.invoices.length === 0}>
              Confirm payment
            </Button>
          </div>
        </form>
      )}

      {mode === 'other_income' && (
        <form aria-label="Other income" className="grid max-w-xl gap-3" onSubmit={submit((fd) => confirmOtherIncomeAction(firmId, accountId, line.id, fd))}>
          <div className="grid gap-1.5">
            <Label htmlFor={`src-${line.id}`}>Received from</Label>
            <Input id={`src-${line.id}`} name="source" defaultValue={payeeFromDescription(line.description)} aria-invalid={!!errors.source} />
            {errors.source && <p className="text-xs text-destructive">{errors.source}</p>}
          </div>
          <CategorySelect id={`oc-${line.id}`} options={incomeCategories} error={errors.categoryId} />
          <Notes id={`on-${line.id}`} error={errors.notes} />
          <div>
            <Button type="submit" disabled={pending}>
              Confirm other income
            </Button>
          </div>
        </form>
      )}

      {mode === 'expense' && (
        <form aria-label="Expense" className="grid max-w-xl gap-3" onSubmit={submit((fd) => confirmExpenseAction(firmId, accountId, line.id, fd))}>
          <div className="grid gap-1.5">
            <Label htmlFor={`payee-${line.id}`}>Payee</Label>
            <Input id={`payee-${line.id}`} name="payee" defaultValue={payeeFromDescription(line.description)} aria-invalid={!!errors.payee} />
            {errors.payee && <p className="text-xs text-destructive">{errors.payee}</p>}
          </div>
          <CategorySelect id={`ec-${line.id}`} options={categories} defaultValue={line.suggestedCategoryId ?? ''} error={errors.categoryId} />
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`cl-${line.id}`}>Client (optional)</Label>
              <select id={`cl-${line.id}`} name="clientId" className={select} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">None</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`pr-${line.id}`}>Project (optional)</Label>
              <select id={`pr-${line.id}`} name="projectId" className={select} defaultValue="">
                <option value="">None</option>
                {projects
                  .filter((p) => !clientId || p.clientId === clientId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <Notes id={`en-${line.id}`} error={errors.notes} />
          <div>
            <Button type="submit" disabled={pending}>
              Confirm expense
            </Button>
          </div>
        </form>
      )}

      {mode === 'existing' && (
        <div className="grid max-w-xl gap-2">
          {!cand ? (
            <p>Looking for matching entries…</p>
          ) : (moneyIn ? cand.payments : cand.expenses).length === 0 ? (
            <p>No unmatched {moneyIn ? 'payment' : 'expense'} of {formatMoney(absAmount, currency)} within 7 days of this date.</p>
          ) : (
            <ul className="grid gap-2">
              {moneyIn
                ? cand.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-2">
                      <span>
                        {p.paid_on} · {p.invoice_number} · {p.client_name} · {formatMoney(p.amount, currency)}
                      </span>
                      <Button type="button" size="sm" disabled={pending} onClick={() => run(() => linkLineAction(firmId, accountId, line.id, { paymentId: p.id }), onDone)}>
                        Match
                      </Button>
                    </li>
                  ))
                : cand.expenses.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-2">
                      <span>
                        {x.spent_on} · {x.payee} · {formatMoney(x.amount, currency)}
                      </span>
                      <Button type="button" size="sm" disabled={pending} onClick={() => run(() => linkLineAction(firmId, accountId, line.id, { expenseId: x.id }), onDone)}>
                        Match
                      </Button>
                    </li>
                  ))}
            </ul>
          )}
        </div>
      )}

      {mode === 'ignore' && (
        <form
          aria-label="Ignore line"
          className="flex max-w-xl flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const reason = String(new FormData(e.currentTarget).get('reason') ?? '')
            run(async () => {
              const r = await ignoreLinesAction(firmId, accountId, [line.id], reason)
              return r.ok ? { ok: true, data: undefined } : r
            }, onDone)
          }}
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor={`ir-${line.id}`}>Reason (optional)</Label>
            <Input id={`ir-${line.id}`} name="reason" maxLength={200} placeholder="Transfer between accounts" />
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            Ignore line
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function CategorySelect({ id, options, defaultValue = '', error }: { id: string; options: Option[]; defaultValue?: string; error?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Category</Label>
      <select id={id} name="categoryId" className={select} defaultValue={defaultValue} aria-invalid={!!error}>
        <option value="">Choose…</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function Notes({ id, error }: { id: string; error?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Notes (optional)</Label>
      <textarea id={id} name="notes" rows={2} maxLength={1000} className="rounded-lg border bg-card px-2 py-1 text-sm" />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
