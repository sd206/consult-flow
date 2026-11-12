import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import { formatMoney } from '@/lib/domain/money'
import { listInvoiceDeposits } from '@/modules/bank/data'
import { getInvoice } from '@/modules/invoices/data'
import { listOpenInvoices } from '@/modules/payments/data'
import { RecordPaymentPanel } from './record-panel'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const field = 'h-8 rounded-lg border bg-card px-2 text-sm'
const button = 'inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium'

type Sp = Record<string, string | string[] | undefined>

export default async function RecordPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>
  searchParams: Promise<Sp>
}) {
  const { firmId } = await params
  const sp = await searchParams
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const invoiceId = typeof sp.invoice === 'string' && UUID.test(sp.invoice) ? sp.invoice : null
  const fromPayments = sp.from === 'payments'
  const paymentsHref = `/f/${firmId}/payments`

  const inv = invoiceId ? await getInvoice(db, firmId, invoiceId) : null
  const backHref = fromPayments || !invoiceId ? paymentsHref : `/f/${firmId}/invoices/${invoiceId}#payments`
  const back = (
    <Link href={backHref} className="text-sm underline underline-offset-4">
      {fromPayments || !invoiceId ? 'Payments' : 'Back to invoice'}
    </Link>
  )

  // Step 1: choose the invoice.
  if (!inv || !inv.ok) {
    const open = await listOpenInvoices(db, firmId)
    return (
      <div className="max-w-4xl">
        {back}
        <h1 className="mt-2 text-2xl font-semibold">Record payment</h1>
        {inv && !inv.ok && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {inv.error}
          </p>
        )}
        {!open.ok ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {open.error}
          </p>
        ) : open.data.length === 0 ? (
          <p className="mt-4 text-sm">There are no issued invoices waiting for payment.</p>
        ) : (
          <form method="get" aria-label="Choose invoice" className="mt-4 flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="from" value={fromPayments ? 'payments' : ''} />
            <div className="flex flex-col gap-1">
              <label htmlFor="rp-invoice">Invoice</label>
              <select id="rp-invoice" name="invoice" required defaultValue="" className={`${field} min-w-80`}>
                <option value="" disabled>
                  Choose an open invoice…
                </option>
                {open.data.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} · {i.clientName} · {i.balanceDue} due
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}>
              Continue
            </button>
          </form>
        )}
      </div>
    )
  }

  // Step 2: record against the chosen invoice.
  const i = inv.data
  const m = (v: string) => formatMoney(v, i.currency)
  const canRecord = i.status === 'issued' || i.status === 'partly_paid'
  const deposits = canRecord ? await listInvoiceDeposits(db, i.id) : null
  const changeHref = `/f/${firmId}/payments/record${fromPayments ? '?from=payments' : ''}`

  return (
    <div className="max-w-5xl">
      {back}
      <h1 className="mt-2 text-2xl font-semibold">Record payment</h1>
      <section aria-label="Invoice" className="mt-4 rounded-xl border bg-card p-4 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-base font-semibold">
            <Link href={`/f/${firmId}/invoices/${i.id}`} className="underline-offset-4 hover:underline">
              {i.number}
            </Link>{' '}
            · {i.clientName}
          </p>
          {fromPayments && (
            <Link href={changeHref} className="underline underline-offset-4">
              Choose a different invoice
            </Link>
          )}
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-1">
          <div className="flex gap-2">
            <dt>Total</dt>
            <dd>{m(i.total)}</dd>
          </div>
          <div className="flex gap-2">
            <dt>Paid</dt>
            <dd>{m(i.amountPaid)}</dd>
          </div>
          <div className="flex gap-2">
            <dt>Balance due</dt>
            <dd data-testid="record-balance-due" className="font-semibold">
              {m(i.balanceDue)}
            </dd>
          </div>
        </dl>
      </section>

      <RecordPaymentPanel
        firmId={firmId}
        invoiceId={i.id}
        invoiceLabel={i.number ?? 'this invoice'}
        currency={i.currency}
        balanceDue={i.balanceDue}
        deposits={deposits && deposits.ok ? deposits.data : null}
        returnHref={backHref}
        closedReason={
          canRecord ? null : i.status === 'paid' ? 'it is fully paid' : i.status === 'void' ? 'it is void' : 'it is a draft'
        }
      />
    </div>
  )
}
