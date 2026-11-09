import { requireFirmRole } from '@/lib/auth/context'
import { listMembers } from '@/modules/members/data'
import { InviteForm, RemoveForm, RoleForm } from './member-controls'

export default async function UsersPage({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params
  const { db, userId } = await requireFirmRole(firmId, ['admin'])
  const members = await listMembers(db, firmId)

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Users</h1>

      {!members.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {members.error}
        </p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <caption className="sr-only">Firm members</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-4 font-medium">
                Member
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Role
              </th>
              <th scope="col" className="py-2 font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {members.data.map((m) => (
              <tr key={m.userId} className="border-b align-top">
                <td className="py-2 pr-4">
                  {m.displayName ? `${m.displayName} (${m.email})` : m.email}
                </td>
                <td className="py-2 pr-4">
                  <RoleForm firmId={firmId} userId={m.userId} email={m.email} role={m.role} />
                </td>
                <td className="py-2">
                  {m.userId !== userId && (
                    <RemoveForm firmId={firmId} userId={m.userId} email={m.email} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-8 text-lg font-medium">Invite a user</h2>
      <InviteForm firmId={firmId} />
    </div>
  )
}
