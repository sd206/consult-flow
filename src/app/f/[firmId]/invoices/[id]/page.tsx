import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFirmRole } from '@/lib/auth/context'
import { formatMoney } from '@/lib/domain/money'
import { listTemplates } from '@/modules/invoice-templates/data'
import { getInvoice, listCandidates } from '@/modules/invoices/data'
import { INVOICE_STATUS_LABEL } from '../status-label'
import { DraftEditor, type ConsultantOption } from './draft-editor'
import { IssuedActions } from './issued-actions'

const th = 'py-2 pr-4 font-medium'
const td = 'py-2 pr-4 align-top'
const PDF_MISSING = "The PDF couldn't be created. Use Regenerate PDF."

export default async function InvoicePage({ params }: { params: Promise<{ firmId: string; id: string }> }) {
  const { firmId, id } = await params
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const res = await getInvoice(db, firmId, id)
  if (!res.ok) notFound()
  const inv = res.data
  const base = `/f/${firmId}/invoices`
  const back = (
    <Link href={base} className="text-sm underline underline-offset-4">
      Invoices
    </Link>
  )

  if (inv.status === 'draft') {
    const [templates, candidates] = await Promise.all([
      listTemplates(db, firmId),
      listCandidates(db, firmId, inv.clientId, inv.periodStart, inv.periodEnd),
    ])
    // Listed: consultants on current time lines ∪ candidates for the period ∪ the stored selection.
    const names = new Map<string, string>()
    for (const l of inv.lines) if (l.kind === 'time' && l.consultantId) names.set(l.consultantId, l.consultantName ?? '')
    if (candidates.ok) for (const c of candidates.data) if (!names.has(c.consultantId)) names.set(c.consultantId, c.consultantName)
    const filter = inv.consultantFilter
    const unnamed = (filter ?? []).filter((cid) => !names.has(cid))
    if (unnamed.length > 0) {
      const { data } = await db.from('consultants').select('id, name').eq('firm_id', firmId).in('id', unnamed)
      for (const c of (data ?? []) as { id: string; name: string }[]) names.set(c.id, c.name)
    }
    // null = all consultants (every box ticked); otherwise ticked iff selected.
    const consultants: ConsultantOption[] = [...names].map(([cid, name]) => ({
      id: cid,
      name,
      checked: filter === null || filter.includes(cid),
    }))
    return (
      <div>
        {back}
        <DraftEditor
          firmId={firmId}
          invoice={inv}
          templates={templates.ok ? templates.data.map((t) => ({ id: t.id, name: t.name })) : []}
          consultants={consultants}
        />
      </div>
    )
  }

  const m = (v: string) => formatMoney(v, inv.currency)
  const cell = 'flex flex-col gap-0.5 text-sm'
  return (
    <div className="max-w-5xl">
      {back}
      <h1 className="mt-2 text-2xl font-semibold">{inv.number ?? 'Invoice'}</h1>
      <p className="mt-1 text-sm">
        Status: <span data-testid="status">{INVOICE_STATUS_LABEL[inv.status]}</span>
      </p>
      {inv.subject && <p className="mt-1 text-sm">{inv.subject}</p>}
      <p className="mt-1 text-sm text-muted-foreground">
        Period {inv.periodStart} to {inv.periodEnd}. Issued {inv.issueDate}, due {inv.dueDate}.
      </p>

      {inv.status !== 'void' && !inv.pdfPath && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {PDF_MISSING}
        </p>
      )}

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className={cell}>
          <h2 className="font-medium">Bill to</h2>
          {inv.billTo && (
            <>
              <span>{inv.billTo.name}</span>
              {inv.billTo.contactName && <span>{inv.billTo.contactName}</span>}
              {inv.billTo.email && <span>{inv.billTo.email}</span>}
              {inv.billTo.phone && <span>{inv.billTo.phone}</span>}
              {inv.billTo.address && <span className="whitespace-pre-line">{inv.billTo.address}</span>}
            </>
          )}
        </div>
        <div className={cell}>
          <h2 className="font-medium">From</h2>
          {inv.from && (
            <>
              <span>{inv.from.name}</span>
              {inv.from.contactName && <span>{inv.from.contactName}</span>}
              {inv.from.contactEmail && <span>{inv.from.contactEmail}</span>}
              {inv.from.contactPhone && <span>{inv.from.contactPhone}</span>}
              {inv.from.address && <span className="whitespace-pre-line">{inv.from.address}</span>}
            </>
          )}
        </div>
      </div>

      <table className="mt-8 w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            {['Consultant', 'Project', 'Description', 'Quantity', 'Rate', 'Amount'].map((h) => (
              <th key={h} scope="col" className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.id} className="border-b">
              <td className={td}>{l.consultantName}</td>
              <td className={td}>{l.projectName}</td>
              <td className={td}>{l.description}</td>
              <td className={td}>{l.quantity}</td>
              <td className={td}>{m(l.unitPrice)}</td>
              <td className={td}>{m(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto mt-6 flex w-full max-w-xs flex-col gap-1 text-sm">
        <div className="flex justify-between gap-8">
          <dt>Subtotal</dt>
          <dd data-testid="subtotal">{m(inv.subtotal)}</dd>
        </div>
        {inv.discountType !== 'none' && (
          <div className="flex justify-between gap-8">
            <dt>{inv.discountLabel ?? 'Discount'}</dt>
            <dd data-testid="discount">-{m(inv.discountAmount)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-8">
          <dt>Tax ({inv.taxPercent}%)</dt>
          <dd data-testid="tax">{m(inv.taxAmount)}</dd>
        </div>
        <div className="flex justify-between gap-8 border-t pt-1 font-semibold">
          <dt>Total</dt>
          <dd data-testid="total">{m(inv.total)}</dd>
        </div>
      </dl>

      <IssuedActions firmId={firmId} invoiceId={inv.id} status={inv.status} hasPdf={!!inv.pdfPath} />
    </div>
  )
}
