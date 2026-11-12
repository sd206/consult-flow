'use client'

import { askConfirm } from '@/components/confirm-dialog'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { FileList } from '@/components/attachments/file-list'
import { FILE_ACCEPT, takeFiles, uploadFiles } from '@/components/attachments/upload-files'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MAX_FILES_PER_UPLOAD, TOO_MANY_FILES } from '@/lib/domain/attachments'
import { todayIso } from '@/lib/domain/dates'
import { formatMoney } from '@/lib/domain/money'
import type { FieldErrors, FormResult } from '@/lib/form'
import { rejectedFilesParam } from '@/lib/domain/rejected-files'
import {
  createExpenseForUploadAction,
  createExpenseUploadTargetsAction,
  deleteExpenseAction,
  deleteExpenseAttachmentAction,
  finalizeExpenseUploadsAction,
  updateExpenseAction,
} from '@/modules/expenses/actions'
import { useRun } from '@/components/use-run'

export type CategoryOption = { id: string; name: string; active: boolean }
export type ClientOption = { id: string; name: string }
export type ProjectOption = { id: string; name: string; clientId: string; clientName: string }
export type ExpenseValues = {
  id: string
  spentOn: string
  categoryId: string
  payee: string
  amount: string
  clientId: string | null
  projectId: string | null
  notes: string | null
}

const SOMETHING_WENT_WRONG = 'Something went wrong. Please try again.'
const selectClass = 'h-8 rounded-lg border bg-card px-2 text-sm'

function uploadReceipts(firmId: string, expenseId: string, files: File[]): Promise<string[]> {
  return uploadFiles(files, {
    createTargets: (declared) => createExpenseUploadTargetsAction(firmId, expenseId, declared),
    finalize: (items) => finalizeExpenseUploadsAction(firmId, expenseId, items),
  })
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null
}

/** Project options grouped under their client. */
function groupProjects(projects: ProjectOption[]): { clientName: string; projects: ProjectOption[] }[] {
  const groups = new Map<string, { clientName: string; projects: ProjectOption[] }>()
  for (const p of projects) {
    const g = groups.get(p.clientId) ?? { clientName: p.clientName, projects: [] }
    g.projects.push(p)
    groups.set(p.clientId, g)
  }
  return [...groups.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, 'en', { sensitivity: 'base' }))
}

export function ExpenseForm({
  firmId,
  categories,
  clients,
  projects,
  expense,
}: {
  firmId: string
  categories: CategoryOption[]
  clients: ClientOption[]
  projects: ProjectOption[]
  /** Present when editing. */
  expense?: ExpenseValues
}) {
  const router = useRouter()
  const run = useRun()
  const [pending, startTransition] = useTransition()
  const [createErrors, setCreateErrors] = useState<FieldErrors>({})
  const [createError, setCreateError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // One id per new-expense form: a retried save (lost response, double submit) can't create a second expense.
  const newId = useRef<string | null>(null)

  const errors = expense ? run.errors : createErrors
  const error = expense ? run.error : createError
  const busy = expense ? run.pending : pending
  const categoryOptions = categories.filter((c) => c.active || c.id === expense?.categoryId)
  const [projectId, setProjectId] = useState(expense?.projectId ?? '')
  const project = projects.find((p) => p.id === projectId)
  // With a project, the client is the project's (set by the database): shown, not chosen.
  const clientValue = project ? project.clientId : (expense?.clientId ?? '')
  const clientOptions =
    project && !clients.some((c) => c.id === project.clientId)
      ? [...clients, { id: project.clientId, name: project.clientName }]
      : clients

  function submit(fd: FormData) {
    setSaved(false)
    if (expense) {
      run.run(
        () => updateExpenseAction(firmId, expense.id, fd),
        () => setSaved(true),
      )
      return
    }
    startTransition(async () => {
      setCreateErrors({})
      setCreateError(null)
      try {
        const files = takeFiles(fd)
        if (files.length > MAX_FILES_PER_UPLOAD) {
          setCreateErrors({ files: TOO_MANY_FILES })
          setCreateError(TOO_MANY_FILES)
          return
        }
        newId.current ??= crypto.randomUUID()
        fd.set('id', newId.current)
        const r = await createExpenseForUploadAction(firmId, fd)
        if (!r.ok) {
          setCreateErrors(r.fieldErrors ?? {})
          setCreateError(r.error)
          return
        }
        const failed = await uploadReceipts(firmId, r.data.id, files)
        const q = failed.length > 0 ? `&filesRejected=${encodeURIComponent(rejectedFilesParam(failed))}` : ''
        router.push(`/f/${firmId}/expenses/${r.data.id}?added=1${q}`)
      } catch (e) {
        console.error('create expense failed', e)
        setCreateError(SOMETHING_WENT_WRONG)
      }
    })
  }

  return (
    <form
      aria-label="Expense"
      className="mt-4 flex max-w-xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit(new FormData(e.currentTarget))
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="exp-date">Date</Label>
        <Input
          id="exp-date"
          name="spentOn"
          type="date"
          defaultValue={expense?.spentOn ?? todayIso()}
          aria-invalid={!!errors.spentOn}
          className="max-w-40"
        />
        <FieldError message={errors.spentOn} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="exp-category">Category</Label>
        <select
          id="exp-category"
          name="categoryId"
          defaultValue={expense?.categoryId ?? ''}
          aria-invalid={!!errors.categoryId}
          className={`${selectClass} max-w-64`}
        >
          {!expense && <option value="">Choose a category</option>}
          {categoryOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.active ? c.name : `${c.name} (retired)`}
            </option>
          ))}
        </select>
        <FieldError message={errors.categoryId} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="exp-payee">Payee</Label>
        <Input id="exp-payee" name="payee" defaultValue={expense?.payee ?? ''} aria-invalid={!!errors.payee} />
        <FieldError message={errors.payee} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="exp-amount">Amount</Label>
        <Input
          id="exp-amount"
          name="amount"
          type="text"
          inputMode="decimal"
          defaultValue={expense?.amount ?? ''}
          aria-invalid={!!errors.amount}
          className="max-w-40"
        />
        <FieldError message={errors.amount} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="exp-client">Client</Label>
        <select
          // Re-created whenever the shown client changes: after a save the stored client is shown,
          // and with a project the project's client is.
          key={`${project ? 'project' : 'own'}:${clientValue}`}
          id="exp-client"
          name="clientId"
          defaultValue={clientValue}
          disabled={!!project}
          aria-invalid={!!errors.clientId}
          className={`${selectClass} max-w-64`}
        >
          <option value="">No client</option>
          {clientOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <FieldError message={errors.clientId} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="exp-project">Project</Label>
        <select
          id="exp-project"
          name="projectId"
          defaultValue={expense?.projectId ?? ''}
          onChange={(e) => setProjectId(e.currentTarget.value)}
          aria-invalid={!!errors.projectId}
          aria-describedby="exp-project-note"
          className={`${selectClass} max-w-64`}
        >
          <option value="">No project</option>
          {groupProjects(projects).map((g) => (
            <optgroup key={g.clientName} label={g.clientName}>
              {g.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p id="exp-project-note" className="text-xs text-muted-foreground">
          The client is set from the project.
        </p>
        <FieldError message={errors.projectId} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="exp-notes">Notes</Label>
        <textarea
          id="exp-notes"
          name="notes"
          rows={3}
          defaultValue={expense?.notes ?? ''}
          aria-invalid={!!errors.notes}
          className="rounded-lg border bg-card px-2.5 py-1 text-sm"
        />
        <FieldError message={errors.notes} />
      </div>
      {!expense && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="exp-files">Receipts</Label>
          <input id="exp-files" name="files" type="file" multiple accept={FILE_ACCEPT} className="text-sm" aria-invalid={!!errors.files} />
          <FieldError message={errors.files} />
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          Save expense
        </Button>
        {saved && (
          <p role="status" className="text-sm">
            Expense saved.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

export function ReceiptsSection({
  firmId,
  expenseId,
  receipts,
}: {
  firmId: string
  expenseId: string
  receipts: { id: string; fileName: string }[]
}) {
  const { pending, run, errors, error } = useRun()
  const [warning, setWarning] = useState<string | null>(null)
  const [resets, setResets] = useState(0)
  return (
    <section aria-labelledby="receipts-h" className="mt-10 max-w-xl">
      <h2 id="receipts-h" className="text-lg font-semibold">
        Receipts
      </h2>
      {receipts.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No receipts attached.</p>
      ) : (
        <div className="mt-3">
          <FileList
            files={receipts}
            downloadBase={`/f/${firmId}/attachments`}
            onRemove={(attachmentId) => deleteExpenseAttachmentAction(firmId, expenseId, attachmentId)}
          />
        </div>
      )}
      <form
        key={resets}
        aria-label="Add receipts"
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          setWarning(null)
          run(
            async (): Promise<FormResult> => {
              const files = takeFiles(fd)
              if (files.length === 0) return { ok: false, error: 'Choose a file to add.', fieldErrors: { files: 'Choose a file to add.' } }
              if (files.length > MAX_FILES_PER_UPLOAD) return { ok: false, error: TOO_MANY_FILES, fieldErrors: { files: TOO_MANY_FILES } }
              const failed = await uploadReceipts(firmId, expenseId, files)
              if (failed.length > 0) setWarning(`Some receipts weren't attached: ${failed.join(', ')}.`)
              return { ok: true, data: undefined }
            },
            () => setResets((n) => n + 1),
          )
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="add-files">Add receipts</Label>
          <input id="add-files" name="files" type="file" multiple accept={FILE_ACCEPT} className="text-sm" aria-invalid={!!errors.files} />
          {errors.files && <p className="text-xs text-destructive">{errors.files}</p>}
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          Upload receipts
        </Button>
      </form>
      {error && !errors.files && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {warning && (
        <p role="status" className="mt-2 text-sm">
          {warning}
        </p>
      )}
    </section>
  )
}

export function DeleteExpenseButton({
  firmId,
  expenseId,
  amount,
  currency,
}: {
  firmId: string
  expenseId: string
  amount: string
  currency: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="mt-10">
      <Button
        type="button"
        variant="destructive"
        disabled={pending}
        onClick={async () => {
          if (!(await askConfirm(`Delete this expense of ${formatMoney(amount, currency)}? Its receipts are deleted too.`, { confirmLabel: 'Delete', destructive: true }))) return
          setError(null)
          startTransition(async () => {
            try {
              const r = await deleteExpenseAction(firmId, expenseId)
              if (r.ok) router.push(`/f/${firmId}/expenses`)
              else setError(r.error)
            } catch (e) {
              console.error('delete expense failed', e)
              setError(SOMETHING_WENT_WRONG)
            }
          })
        }}
      >
        Delete expense
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
