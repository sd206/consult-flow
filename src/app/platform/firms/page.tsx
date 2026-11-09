import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth/context'
import { CreateFirmForm } from './create-firm-form'

export default async function PlatformFirmsPage() {
  const { isPlatformOwner, db } = await requireUser()
  if (!isPlatformOwner) notFound()

  const { data, error } = await db.rpc('platform_list_firms')
  if (error) console.error('platform_list_firms failed', error)

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Firms</h1>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          We could not load the firms.
        </p>
      ) : (data ?? []).length === 0 ? (
        <p className="mt-4 text-sm">No firms yet.</p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <caption className="sr-only">All firms</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-4 font-medium">
                Name
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Admins
              </th>
              <th scope="col" className="py-2 font-medium">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((f) => (
              <tr key={f.id} className="border-b">
                <td className="py-2 pr-4">{f.name}</td>
                <td className="py-2 pr-4">{f.admin_emails.join(', ')}</td>
                <td className="py-2">{new Date(f.created_at).toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-8 text-lg font-medium">Create a firm</h2>
      <CreateFirmForm />
    </main>
  )
}
