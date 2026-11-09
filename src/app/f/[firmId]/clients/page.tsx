import { requireFirmRole } from '@/lib/auth/context'
import { listClients } from '@/modules/clients/data'
import { ClientActiveForm, ClientForm, DeleteClientForm } from './client-forms'

export default async function ClientsPage({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const clients = await listClients(db, firmId, { includeInactive: true })

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Clients</h1>

      {!clients.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {clients.error}
        </p>
      ) : clients.data.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No clients yet.</p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <caption className="sr-only">Clients</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-4 font-medium">
                Client
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Billing contact
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Status
              </th>
              <th scope="col" className="py-2 font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {clients.data.map((c) => (
              <tr key={c.id} className="border-b align-top">
                <th scope="row" className="py-2 pr-4 font-normal">
                  {c.name}
                </th>
                <td className="py-2 pr-4">
                  {[c.billingContactName, c.billingEmail, c.billingPhone].filter(Boolean).join(' · ')}
                </td>
                <td className="py-2 pr-4">{c.active ? 'Active' : 'Inactive'}</td>
                <td className="py-2">
                  <div className="flex flex-col gap-2">
                    <ClientActiveForm firmId={firmId} client={c} />
                    <DeleteClientForm firmId={firmId} client={c} />
                    <details>
                      <summary className="cursor-pointer text-sm underline-offset-4 hover:underline">
                        Edit<span className="sr-only"> {c.name}</span>
                      </summary>
                      <ClientForm firmId={firmId} client={c} />
                    </details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-8 text-lg font-medium">Add a client</h2>
      <ClientForm firmId={firmId} />
    </div>
  )
}
