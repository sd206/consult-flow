import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import { formatMoney } from '@/lib/domain/money'
import { listConsultants } from '@/modules/consultants/data'
import { getFirm } from '@/modules/firms/data'
import { listVendors } from '@/modules/vendors/data'
import { ConsultantForm } from './consultant-forms'

export default async function ConsultantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>
  searchParams: Promise<{ inactive?: string }>
}) {
  const { firmId } = await params
  const includeInactive = (await searchParams).inactive === '1'
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const [consultants, vendors, firm] = await Promise.all([
    listConsultants(db, firmId, { includeInactive }),
    listVendors(db, firmId),
    getFirm(db, firmId),
  ])
  const currency = firm.ok ? firm.data.currency : 'USD'
  const base = `/f/${firmId}/consultants`

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Consultants</h1>
      <p className="mt-2 text-sm">
        <Link href={includeInactive ? base : `${base}?inactive=1`} className="underline underline-offset-4">
          {includeInactive ? 'Hide inactive consultants' : 'Show inactive consultants'}
        </Link>
      </p>

      {!consultants.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {consultants.error}
        </p>
      ) : consultants.data.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No consultants yet.</p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <caption className="sr-only">Consultants</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-4 font-medium">
                Name
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Email
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Type
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Vendor
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Current cost / hour
              </th>
              <th scope="col" className="py-2 font-medium">
                Login
              </th>
            </tr>
          </thead>
          <tbody>
            {consultants.data.map((c) => (
              <tr key={c.id} className="border-b">
                <th scope="row" className="py-2 pr-4 font-normal">
                  <Link href={`${base}/${c.id}`} className="underline underline-offset-4">
                    {c.name}
                  </Link>
                  {!c.active && <span className="ml-2 text-muted-foreground">(inactive)</span>}
                </th>
                <td className="py-2 pr-4">{c.email}</td>
                <td className="py-2 pr-4">{c.type}</td>
                <td className="py-2 pr-4">{c.vendorName ?? ''}</td>
                <td className="py-2 pr-4">{c.currentCost ? formatMoney(c.currentCost, currency) : 'Not set'}</td>
                <td className="py-2">{c.hasLogin ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-8 text-lg font-medium">Add a consultant</h2>
      <ConsultantForm
        firmId={firmId}
        vendors={vendors.ok ? vendors.data.map((v) => ({ id: v.id, name: v.name })) : []}
      />
    </div>
  )
}
