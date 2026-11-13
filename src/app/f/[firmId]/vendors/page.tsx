import { requireFirmRole } from '@/lib/auth/context'
import { listVendors } from '@/modules/vendors/data'
import { DeleteVendorForm, VendorForm } from './vendor-forms'

export default async function VendorsPage({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params
  const { db, role } = await requireFirmRole(firmId, ['admin', 'manager'])
  const canEdit = role === 'admin'
  const vendors = await listVendors(db, firmId)

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Vendors</h1>

      {!vendors.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {vendors.error}
        </p>
      ) : vendors.data.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No vendors yet.</p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <caption className="sr-only">Vendors</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-4 font-medium">
                Vendor
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Contact
              </th>
              {canEdit && (
                <th scope="col" className="py-2 font-medium">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {vendors.data.map((v) => (
              <tr key={v.id} className="border-b align-top">
                <th scope="row" className="py-2 pr-4 font-normal">
                  {v.name}
                </th>
                <td className="py-2 pr-4">{[v.contactName, v.email, v.phone].filter(Boolean).join(' · ')}</td>
                {canEdit && (
                <td className="py-2">
                  <div className="flex flex-col gap-2">
                    <DeleteVendorForm firmId={firmId} vendor={v} />
                    <details>
                      <summary className="cursor-pointer text-sm underline-offset-4 hover:underline">
                        Edit<span className="sr-only"> {v.name}</span>
                      </summary>
                      <VendorForm firmId={firmId} vendor={v} />
                    </details>
                  </div>
                </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit ? (
        <>
          <h2 className="mt-8 text-lg font-medium">Add a vendor</h2>
          <VendorForm firmId={firmId} />
        </>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">Only Admins can add or change vendors.</p>
      )}
    </div>
  )
}
