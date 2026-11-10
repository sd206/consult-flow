'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatMoney } from '@/lib/domain/money'
import {
  deleteDraftAction,
  issueInvoiceAction,
  regenerateLinesAction,
  updateDraftHeaderAction,
  updatePeriodAction,
} from '@/modules/invoices/actions'
import type { InvoiceDetail } from '@/modules/invoices/data'
import { issueConfirmText } from '@/modules/invoices/issue-confirm'
import { DiscountForm } from './discount-form'
import { LinesTable } from './lines-table'
import { useRun } from '@/components/use-run'

export type ConsultantOption = { id: string; name: string; checked: boolean }
export type TemplateOption = { id: string; name: string }

const select = 'h-8 rounded-lg border bg-card px-2 text-sm'

function HeaderForm({
  firmId,
  invoice,
  templates,
}: {
  firmId: string
  invoice: InvoiceDetail
  templates: TemplateOption[]
}) {
  const { pending, run, errors, error } = useRun()
  return (
    <form
      className="mt-6 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        run(() => updateDraftHeaderAction(firmId, invoice.id, fd))
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="hdr-subject">Subject</Label>
        <Input
          id="hdr-subject"
          name="subject"
          defaultValue={invoice.subject ?? ''}
          aria-invalid={!!errors.subject}
          className="min-w-56"
        />
        {errors.subject && <p className="text-xs text-destructive">{errors.subject}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="hdr-issue">Issue date</Label>
        <Input id="hdr-issue" name="issueDate" type="date" defaultValue={invoice.issueDate} aria-invalid={!!errors.issueDate} />
        {errors.issueDate && <p className="text-xs text-destructive">{errors.issueDate}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="hdr-due">Due date</Label>
        <Input id="hdr-due" name="dueDate" type="date" defaultValue={invoice.dueDate} aria-invalid={!!errors.dueDate} />
        {errors.dueDate && <p className="text-xs text-destructive">{errors.dueDate}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="hdr-tax">Tax %</Label>
        <Input
          id="hdr-tax"
          name="taxPercent"
          inputMode="decimal"
          defaultValue={invoice.taxPercent}
          aria-invalid={!!errors.taxPercent}
          className="max-w-24"
        />
        {errors.taxPercent && <p className="text-xs text-destructive">{errors.taxPercent}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="hdr-template">Template</Label>
        <select id="hdr-template" name="templateId" defaultValue={invoice.templateId} className={select}>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {errors.templateId && <p className="text-xs text-destructive">{errors.templateId}</p>}
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Save details
      </Button>
      {error && !Object.keys(errors).length && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

function PeriodForm({
  firmId,
  invoice,
  consultants,
}: {
  firmId: string
  invoice: InvoiceDetail
  consultants: ConsultantOption[]
}) {
  const { pending, run, errors, error } = useRun()
  const keyOf = consultants.map((c) => `${c.id}:${c.checked}`).join(',')
  return (
    <form
      key={`${invoice.periodStart}|${invoice.periodEnd}|${keyOf}`}
      className="mt-6 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        // Every listed box ticked = all consultants (null), so consultants whose hours
        // only fall in a widened period are picked up too. With nothing listed, keep
        // the stored selection (null or none).
        const boxes = [...e.currentTarget.querySelectorAll<HTMLInputElement>('input[name="consultant"]')]
        const all = boxes.length > 0 ? boxes.every((b) => b.checked) : invoice.consultantFilter === null
        if (all) fd.set('allConsultants', '1')
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
        run(() =>
          submitter?.value === 'period'
            ? updatePeriodAction(firmId, invoice.id, fd)
            : regenerateLinesAction(firmId, invoice.id, fd),
        )
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="per-start">Period start</Label>
          <Input id="per-start" name="periodStart" type="date" defaultValue={invoice.periodStart} aria-invalid={!!errors.periodStart} />
          {errors.periodStart && <p className="text-xs text-destructive">{errors.periodStart}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="per-end">Period end</Label>
          <Input id="per-end" name="periodEnd" type="date" defaultValue={invoice.periodEnd} aria-invalid={!!errors.periodEnd} />
          {errors.periodEnd && <p className="text-xs text-destructive">{errors.periodEnd}</p>}
        </div>
        <Button type="submit" name="intent" value="period" variant="outline" disabled={pending}>
          Update period
        </Button>
      </div>
      {consultants.length > 0 && (
        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-1 text-sm font-medium">Consultants to include</legend>
          {consultants.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="consultant" value={c.id} defaultChecked={c.checked} />
              {c.name}
            </label>
          ))}
        </fieldset>
      )}
      <div>
        <Button type="submit" name="intent" value="regenerate" variant="outline" disabled={pending}>
          Regenerate lines
        </Button>
      </div>
      {error && !errors.periodStart && !errors.periodEnd && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

function Totals({ invoice }: { invoice: InvoiceDetail }) {
  const m = (v: string) => formatMoney(v, invoice.currency)
  const hasDiscount = invoice.discountType !== 'none'
  const row = 'flex justify-between gap-8'
  return (
    <dl className="ml-auto mt-6 flex w-full max-w-xs flex-col gap-1 text-sm">
      <div className={row}>
        <dt>Subtotal</dt>
        <dd data-testid="subtotal">{m(invoice.subtotal)}</dd>
      </div>
      {hasDiscount && (
        <div className={row}>
          <dt>{invoice.discountLabel ?? 'Discount'}</dt>
          <dd data-testid="discount">-{m(invoice.discountAmount)}</dd>
        </div>
      )}
      <div className={row}>
        <dt>Tax ({invoice.taxPercent}%)</dt>
        <dd data-testid="tax">{m(invoice.taxAmount)}</dd>
      </div>
      <div className={`${row} border-t pt-1 font-semibold`}>
        <dt>Total</dt>
        <dd data-testid="total">{m(invoice.total)}</dd>
      </div>
    </dl>
  )
}

export function DraftEditor({
  firmId,
  invoice,
  templates,
  consultants,
}: {
  firmId: string
  invoice: InvoiceDetail
  templates: TemplateOption[]
  consultants: ConsultantOption[]
}) {
  const { pending, run, error, router } = useRun()
  const pdfHref = `/f/${firmId}/invoices/${invoice.id}/pdf`

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Draft invoice</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {invoice.clientName}, {invoice.periodStart} to {invoice.periodEnd}
      </p>

      <HeaderForm firmId={firmId} invoice={invoice} templates={templates} />
      <PeriodForm firmId={firmId} invoice={invoice} consultants={consultants} />
      <LinesTable firmId={firmId} invoiceId={invoice.id} lines={invoice.lines} currency={invoice.currency} />
      <DiscountForm key={`${invoice.discountType}|${invoice.discountValue}|${invoice.discountLabel}`} firmId={firmId} invoice={invoice} />
      <Totals invoice={invoice} />

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <a
          href={pdfHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm font-medium"
        >
          Preview PDF
        </a>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(issueConfirmText(invoice.issueDate, invoice.dueDate))) {
              run(() => issueInvoiceAction(firmId, invoice.id))
            }
          }}
        >
          Issue invoice
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => {
            if (window.confirm('Delete this draft? This cannot be undone.')) {
              run(
                () => deleteDraftAction(firmId, invoice.id),
                () => router.push(`/f/${firmId}/invoices`),
              )
            }
          }}
        >
          Delete draft
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
