import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import type { InvoiceStatus } from '@/lib/db-types'
import { formatMoney } from '@/lib/domain/money'
import { listInvoices } from '@/modules/invoices/data'
import { INVOICE_STATUS_LABEL, INVOICE_STATUSES } from './status-label'

const th = 'py-2 pr-4 font-medium'
const td = 'py-2 pr-4'
const filterLink = 'underline-offset-4 hover:underline aria-[current=page]:font-semibold'

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>
  searchParams: Promise<{ status?: string | string[] }>
}) {
  const { firmId } = await params
  const sp = await searchParams
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const raw = typeof sp.status === 'string' ? sp.status : undefined
  const status = INVOICE_STATUSES.find((s) => s === raw) as InvoiceStatus | undefined
  const list = await listInvoices(db, firmId, { status })
  const base = `/f/${firmId}/invoices`

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <div className="flex items-center gap-4">
          <Link href={`${base}/unpaid`} className="text-sm underline underline-offset-4">
            Unpaid invoices
          </Link>
          <Link
            href={`${base}/new`}
            className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground"
          >
            New invoice
          </Link>
        </div>
      </div>

      <nav aria-label="Invoice status" className="mt-4">
        <ul className="flex flex-wrap gap-4 text-sm">
          <li>
            <Link href={base} aria-current={status ? undefined : 'page'} className={filterLink}>
              All
            </Link>
          </li>
          {INVOICE_STATUSES.map((s) => (
            <li key={s}>
              <Link
                href={`${base}?status=${s}`}
                aria-current={status === s ? 'page' : undefined}
                className={filterLink}
              >
                {INVOICE_STATUS_LABEL[s]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {!list.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {list.error}
        </p>
      ) : list.data.length === 0 ? (
        <p className="mt-6 text-sm">No invoices yet.</p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              {['Number', 'Client', 'Period', 'Issue date', 'Due date', 'Total', 'Status'].map((h) => (
                <th key={h} scope="col" className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.data.map((r) => (
              <tr key={r.id} className="border-b">
                <td className={td}>
                  <Link href={`${base}/${r.id}`} className="underline underline-offset-4">
                    {r.number ?? 'Draft'}
                  </Link>
                </td>
                <td className={td}>{r.clientName}</td>
                <td className={td}>
                  {r.periodStart} to {r.periodEnd}
                </td>
                <td className={td}>{r.issueDate}</td>
                <td className={td}>{r.dueDate}</td>
                <td className={td}>{formatMoney(r.total, r.currency)}</td>
                <td className={td}>{INVOICE_STATUS_LABEL[r.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
