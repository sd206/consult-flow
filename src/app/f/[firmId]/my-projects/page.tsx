import { requireFirmRole } from '@/lib/auth/context'
import { todayIso } from '@/lib/domain/dates'
import { listMyAssignments } from '@/modules/projects/data'

export default async function MyProjectsPage({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params
  const { db } = await requireFirmRole(firmId, ['admin', 'manager', 'consultant'])
  const result = await listMyAssignments(db, firmId)
  const today = todayIso()
  const rows = result.ok ? result.data.filter((a) => a.effectiveTo === null || a.effectiveTo >= today) : []

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">My projects</h1>

      {!result.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {result.error}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">You aren&apos;t assigned to any projects yet.</p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <caption className="sr-only">My projects</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-4 font-medium">
                Project
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Code
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Client
              </th>
              <th scope="col" className="py-2 font-medium">
                Period
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.assignmentId} className="border-b">
                <th scope="row" className="py-2 pr-4 font-normal">
                  {a.projectName}
                </th>
                <td className="py-2 pr-4">{a.projectCode ?? ''}</td>
                <td className="py-2 pr-4">{a.clientName}</td>
                <td className="py-2">
                  {a.effectiveFrom} to {a.effectiveTo ?? 'ongoing'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
