import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFirmRole } from '@/lib/auth/context'
import { formatMoney } from '@/lib/domain/money'
import { getConsultant } from '@/modules/consultants/data'
import { getFirm } from '@/modules/firms/data'
import { listVendors } from '@/modules/vendors/data'
import { ActiveForm, ConsultantForm, CostRateForm, DeleteRateForm, InviteForm } from '../consultant-forms'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function ConsultantPage({ params }: { params: Promise<{ firmId: string; id: string }> }) {
  const { firmId, id } = await params
  const { db, role } = await requireFirmRole(firmId, ['admin', 'manager'])
  if (!UUID_RE.test(id)) notFound()

  const [consultant, vendors, firm] = await Promise.all([
    getConsultant(db, firmId, id),
    listVendors(db, firmId),
    getFirm(db, firmId),
  ])
  if (!consultant.ok) notFound()
  const c = consultant.data
  const currency = firm.ok ? firm.data.currency : 'USD'

  return (
    <div className="max-w-3xl">
      <p className="text-sm">
        <Link href={`/f/${firmId}/consultants`} className="underline underline-offset-4">
          Back to consultants
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">{c.name}</h1>
      <p className="text-sm text-muted-foreground">
        {c.type}
        {c.vendorName ? ` · ${c.vendorName}` : ''} · {c.active ? 'Active' : 'Inactive'} ·{' '}
        {c.hasLogin ? 'Can log in' : 'No login yet'}
      </p>

      <div className="mt-4 flex flex-wrap gap-4">
        <ActiveForm firmId={firmId} consultantId={c.id} active={c.active} />
        {role === 'admin' && !c.hasLogin && <InviteForm firmId={firmId} consultantId={c.id} />}
      </div>

      <h2 className="mt-8 text-lg font-medium">Details</h2>
      <ConsultantForm
        firmId={firmId}
        vendors={vendors.ok ? vendors.data.map((v) => ({ id: v.id, name: v.name })) : []}
        consultant={{ id: c.id, name: c.name, email: c.email, type: c.type, vendorId: c.vendorId }}
      />

      <h2 className="mt-8 text-lg font-medium">Cost rates</h2>
      {c.costRates.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No cost rates yet.</p>
      ) : (
        <table className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">Cost rates, newest first</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-4 font-medium">
                Effective from
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Hourly cost
              </th>
              <th scope="col" className="py-2 font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {c.costRates.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="py-2 pr-4">{r.effectiveFrom}</td>
                <td className="py-2 pr-4">{formatMoney(r.hourlyCost, currency)}</td>
                <td className="py-2">
                  <DeleteRateForm firmId={firmId} consultantId={c.id} rateId={r.id} label={r.effectiveFrom} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className="mt-6 text-base font-medium">Add a cost rate</h3>
      <CostRateForm firmId={firmId} consultantId={c.id} />
    </div>
  )
}
