'use client'

import type { InvoiceDeposit } from '@/modules/bank/data'
import { BankDeposits } from './bank-deposits'

import { askConfirm } from '@/components/confirm-dialog'
import { useState } from 'react'
import { FileList } from '@/components/attachments/file-list'
import { FILE_ACCEPT, takeFiles, uploadFiles } from '@/components/attachments/upload-files'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MAX_FILES_PER_UPLOAD, TOO_MANY_FILES } from '@/lib/domain/attachments'
import { todayIso } from '@/lib/domain/dates'
import { formatMoney } from '@/lib/domain/money'
import {
  createUploadTargetsAction,
  deleteAttachmentAction,
  deletePaymentAction,
  finalizeUploadsAction,
  recordPaymentAction,
  updatePaymentAction,
} from '@/modules/payments/actions'
import type { PaymentRow } from '@/modules/payments/data'
import { INVOICE_STATUS_LABEL } from '../status-label'
import { useRun } from '@/components/use-run'

const METHOD_LABEL: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  check: 'Check',
  card: 'Card',
  cash: 'Cash',
  other: 'Other',
}
const th = 'py-2 pr-4 font-medium'
const td = 'py-2 pr-4 align-top'
const select = 'h-8 rounded-lg border bg-card px-2 text-sm'
const TOO_MANY = { ok: false as const, error: TOO_MANY_FILES, fieldErrors: { files: TOO_MANY_FILES } }

function uploadPaymentFiles(firmId: string, invoiceId: string, paymentId: string, files: File[]): Promise<string[]> {
  return uploadFiles(files, {
    createTargets: (declared) => createUploadTargetsAction(firmId, invoiceId, paymentId, declared),
    finalize: (items) => finalizeUploadsAction(firmId, invoiceId, paymentId, items),
  })
}

function notAttached(verb: 'recorded' | 'updated', names: string[]): string | null {
  return names.length === 0 ? null : `Payment ${verb}, but some files weren't attached: ${names.join(', ')}.`
}

type Props = {
  firmId: string
  invoiceId: string
  status: 'issued' | 'partly_paid' | 'paid' | 'void'
  currency: string
  amountPaid: string
  balanceDue: string
  payments: PaymentRow[]
  /** Set when the payments could not be loaded; shown instead of an empty list. */
  paymentsError?: string | null
  /** Imported bank deposits that could pay this invoice; null when unavailable. */
  deposits: InvoiceDeposit[] | null
  invoiceLabel: string
}

function MethodSelect({ id, defaultValue }: { id: string; defaultValue?: string }) {
  return (
    <select id={id} name="method" defaultValue={defaultValue ?? 'bank_transfer'} className={select}>
      {Object.entries(METHOD_LABEL).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}

function FilesInput({ id, label, error }: { id: string; label: string; error?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <input id={id} name="files" type="file" multiple accept={FILE_ACCEPT} className="text-sm" aria-invalid={!!error} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function RecordForm({
  firmId,
  invoiceId,
  balanceDue,
  onWarning,
}: {
  firmId: string
  invoiceId: string
  balanceDue: string
  onWarning: (w: string | null) => void
}) {
  const { pending, run, errors, error } = useRun()
  const [resets, setResets] = useState(0)
  return (
    <form
      key={`${resets}-${balanceDue}`}
      aria-label="Record payment"
      className="mt-6 flex flex-wrap items-start gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        onWarning(null)
        run(
          async () => {
            const files = takeFiles(fd)
            if (files.length > MAX_FILES_PER_UPLOAD) return TOO_MANY
            const r = await recordPaymentAction(firmId, invoiceId, fd)
            if (!r.ok) return r
            onWarning(notAttached('recorded', await uploadPaymentFiles(firmId, invoiceId, r.data.id, files)))
            return r
          },
          () => setResets((n) => n + 1),
        )
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="rec-amount">Amount</Label>
        <Input
          id="rec-amount"
          name="amount"
          type="text"
          inputMode="decimal"
          defaultValue={balanceDue}
          aria-invalid={!!errors.amount}
          className="max-w-32"
        />
        {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="rec-paid-on">Payment date</Label>
        <Input id="rec-paid-on" name="paidOn" type="date" defaultValue={todayIso()} aria-invalid={!!errors.paidOn} className="max-w-40" />
        {errors.paidOn && <p className="text-xs text-destructive">{errors.paidOn}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="rec-method">Method</Label>
        <MethodSelect id="rec-method" />
        {errors.method && <p className="text-xs text-destructive">{errors.method}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="rec-reference">Reference</Label>
        <Input id="rec-reference" name="reference" aria-invalid={!!errors.reference} className="max-w-48" />
        {errors.reference && <p className="text-xs text-destructive">{errors.reference}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="rec-notes">Notes</Label>
        <Input id="rec-notes" name="notes" aria-invalid={!!errors.notes} className="max-w-64" />
        {errors.notes && <p className="text-xs text-destructive">{errors.notes}</p>}
      </div>
      <FilesInput id="rec-files" label="Files" error={errors.files} />
      <Button type="submit" disabled={pending} className="self-end">
        Record payment
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

function ExistingFiles({ firmId, invoiceId, payment }: { firmId: string; invoiceId: string; payment: PaymentRow }) {
  return (
    <FileList
      files={payment.attachments}
      onRemove={(attachmentId) => deleteAttachmentAction(firmId, invoiceId, payment.id, attachmentId)}
    />
  )
}

function EditForm({
  firmId,
  invoiceId,
  payment: p,
  onDone,
}: {
  firmId: string
  invoiceId: string
  payment: PaymentRow
  onDone: () => void
}) {
  const { pending, run, errors, error } = useRun()
  const [warning, setWarning] = useState<string | null>(null)
  return (
    <form
      aria-label="Edit payment"
      className="flex flex-wrap items-start gap-3 py-2"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        setWarning(null)
        run(async () => {
          const files = takeFiles(fd)
          if (files.length > MAX_FILES_PER_UPLOAD) return TOO_MANY
          const r = await updatePaymentAction(firmId, invoiceId, p.id, fd)
          if (!r.ok) return r
          const warning = notAttached('updated', await uploadPaymentFiles(firmId, invoiceId, p.id, files))
          if (warning) setWarning(warning)
          else onDone()
          return r
        })
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={`ed-paid-on-${p.id}`}>Payment date</Label>
        <Input id={`ed-paid-on-${p.id}`} name="paidOn" type="date" defaultValue={p.paidOn} aria-invalid={!!errors.paidOn} className="max-w-40" />
        {errors.paidOn && <p className="text-xs text-destructive">{errors.paidOn}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`ed-method-${p.id}`}>Method</Label>
        <MethodSelect id={`ed-method-${p.id}`} defaultValue={p.method} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`ed-reference-${p.id}`}>Reference</Label>
        <Input id={`ed-reference-${p.id}`} name="reference" defaultValue={p.reference ?? ''} aria-invalid={!!errors.reference} className="max-w-48" />
        {errors.reference && <p className="text-xs text-destructive">{errors.reference}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`ed-notes-${p.id}`}>Notes</Label>
        <Input id={`ed-notes-${p.id}`} name="notes" defaultValue={p.notes ?? ''} aria-invalid={!!errors.notes} className="max-w-64" />
        {errors.notes && <p className="text-xs text-destructive">{errors.notes}</p>}
      </div>
      <FilesInput id={`ed-files-${p.id}`} label="Add files" error={errors.files} />
      <ExistingFiles firmId={firmId} invoiceId={invoiceId} payment={p} />
      <div className="flex items-end gap-2 self-end">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
      {warning && (
        <p role="status" className="w-full text-sm">
          {warning}
        </p>
      )}
    </form>
  )
}

function PaymentRowView({
  firmId,
  invoiceId,
  currency,
  payment: p,
  editable,
}: {
  firmId: string
  invoiceId: string
  currency: string
  payment: PaymentRow
  editable: boolean
}) {
  const [editing, setEditing] = useState(false)
  const { pending, run, error } = useRun()
  const m = formatMoney(p.amount, currency)
  return (
    <>
      <tr className="border-b">
        <td className={td}>{p.paidOn}</td>
        <td className={td}>{METHOD_LABEL[p.method] ?? p.method}</td>
        <td className={td}>{p.reference}</td>
        <td className={td}>{m}</td>
        <td className={td}>
          <ul className="flex flex-col gap-1">
            {p.attachments.map((a) => (
              <li key={a.id}>
                <a href={`/f/${firmId}/attachments/${a.id}`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  {a.fileName}
                </a>
              </li>
            ))}
          </ul>
        </td>
        {editable && (
          <td className={td}>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setEditing((v) => !v)}>
                Edit
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={async () => {
                  if (await askConfirm(`Delete this payment of ${m}? Its files are deleted too.`, { confirmLabel: 'Delete', destructive: true })) {
                    run(() => deletePaymentAction(firmId, invoiceId, p.id))
                  }
                }}
              >
                Delete
              </Button>
            </div>
            {error && (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {error}
              </p>
            )}
          </td>
        )}
      </tr>
      {editable && editing && (
        <tr className="border-b">
          <td colSpan={6}>
            <EditForm firmId={firmId} invoiceId={invoiceId} payment={p} onDone={() => setEditing(false)} />
          </td>
        </tr>
      )}
    </>
  )
}

export function PaymentsSection({
  firmId,
  invoiceId,
  status,
  currency,
  amountPaid,
  balanceDue,
  payments,
  paymentsError,
  deposits,
  invoiceLabel,
}: Props) {
  const editable = status !== 'void'
  const canRecord = status === 'issued' || status === 'partly_paid'
  const [warning, setWarning] = useState<string | null>(null)
  const m = (v: string) => formatMoney(v, currency)
  return (
    <section id="payments" className="mt-10">
      <h2 className="text-lg font-semibold">Payments</h2>
      <dl className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-1 text-sm">
        <div className="flex gap-2">
          <dt>Status</dt>
          <dd className="rounded-full border px-2 text-xs font-medium" data-testid="status-badge">
            {INVOICE_STATUS_LABEL[status]}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt>Paid</dt>
          <dd data-testid="amount-paid">{m(amountPaid)}</dd>
        </div>
        <div className="flex gap-2">
          <dt>Balance due</dt>
          <dd data-testid="balance-due" className="font-semibold">
            {m(balanceDue)}
          </dd>
        </div>
      </dl>

      {paymentsError ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {paymentsError}
        </p>
      ) : payments.length > 0 ? (
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              {['Date', 'Method', 'Reference', 'Amount', 'Files'].map((h) => (
                <th key={h} scope="col" className={th}>
                  {h}
                </th>
              ))}
              {editable && (
                <th scope="col" className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <PaymentRowView key={p.id} firmId={firmId} invoiceId={invoiceId} currency={currency} payment={p} editable={editable} />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No payments recorded.</p>
      )}

      {canRecord && deposits && (
        <BankDeposits firmId={firmId} invoiceId={invoiceId} invoiceLabel={invoiceLabel} currency={currency} deposits={deposits} />
      )}
      {canRecord && <RecordForm firmId={firmId} invoiceId={invoiceId} balanceDue={balanceDue} onWarning={setWarning} />}
      {warning && (
        <p role="status" className="mt-3 text-sm">
          {warning}
        </p>
      )}
    </section>
  )
}
