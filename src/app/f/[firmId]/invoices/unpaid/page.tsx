import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import { AGE_BUCKET_LABELS, overdueLabel } from '@/lib/domain/ageing'
import { formatMoney } from '@/lib/domain/money'
import { listClients } from '@/modules/clients/data'
import { getFirm } from '@/modules/firms/data'
import { getAgeing, listUnpaid } from '@/modules/receivables/data'

const th = 'py-2 pr-4 font-medium'
const td = 'py-2 pr-4'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function UnpaidInvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>
  searchParams: Promise<{ client?: string | string[] }>
}) {
  const { firmId } = await params
  const sp = await searchParams
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const raw = typeof sp.client === 'string' ? sp.client : ''
  const clientId = UUID.test(raw) ? raw : null
  const [rows, ageing, clients, firm] = await Promise.all([
    listUnpaid(db, firmId, clientId),
    getAgeing(db, firmId, clientId),
    listClients(db, firmId, { includeInactive: true }),
    getFirm(db, firmId),
  ])
  const currency = firm.ok ? firm.data.currency : 'USD'
  const base = `/f/${firmId}/invoices`

  return (
    <div className="max-w-5xl">
      <Link href={base} className="text-sm underline underline-offset-4">
        Invoices
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Unpaid invoices</h1>

      <form method="get" className="mt-4 flex items-end gap-2 text-sm">
        <div>
          <label htmlFor="client" className="block font-medium">
            Client
          </label>
          <select id="client" name="client" defaultValue={clientId ?? ''} className="h-8 rounded border px-2">
            <option value="">All clients</option>
            {clients.ok &&
              clients.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        <button type="submit" className="h-8 rounded-lg border px-2.5 text-sm font-medium">
          Filter
        </button>
      </form>

      {!ageing.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {ageing.error}
        </p>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-5">
          {ageing.data.map((a) => (
            <div key={a.bucket} className="rounded border p-3" data-testid={`ageing-${a.bucket}`}>
              <dt className="text-muted-foreground">{AGE_BUCKET_LABELS[a.bucket]}</dt>
              <dd className="text-lg font-semibold">{formatMoney(a.balanceDue, currency)}</dd>
              <dd className="text-muted-foreground">
                {a.invoiceCount} {a.invoiceCount === 1 ? 'invoice' : 'invoices'}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {!rows.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {rows.error}
        </p>
      ) : rows.data.length === 0 ? (
        <p className="mt-6 text-sm">Nothing outstanding.</p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              {['Number', 'Client', 'Issue date', 'Due date', 'Total', 'Paid', 'Balance due', 'Status', ''].map((h, i) => (
                <th key={i} scope="col" className={th}>
                  {h || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.data.map((r) => {
              const late = overdueLabel(r.daysOverdue)
              return (
                <tr key={r.invoiceId} className="border-b">
                  <td className={td}>
                    <Link href={`${base}/${r.invoiceId}`} className="underline underline-offset-4">
                      {r.number}
                    </Link>
                  </td>
                  <td className={td}>{r.clientName}</td>
                  <td className={td}>{r.issueDate}</td>
                  <td className={td}>
                    {r.dueDate}
                    {late && <span className="ml-2 font-medium text-red-700">{late}</span>}
                  </td>
                  <td className={td}>{formatMoney(r.total, currency)}</td>
                  <td className={td}>{formatMoney(r.amountPaid, currency)}</td>
                  <td className={td}>{formatMoney(r.balanceDue, currency)}</td>
                  <td className={td}>{Number(r.amountPaid) > 0 ? 'Partly paid' : 'Issued'}</td>
                  <td className={td}>
                    <Link href={`${base}/${r.invoiceId}#payments`} className="underline underline-offset-4">
                      Record payment
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
