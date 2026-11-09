import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import { getDashboardSummary } from '@/modules/firms/dashboard'

export default async function FirmDashboard({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params
  const { firmName, role, db } = await requireFirmRole(firmId, ['admin', 'manager', 'consultant'])

  if (role === 'consultant') {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold">{firmName} dashboard</h1>
        <p className="mt-4 text-sm">
          <Link href={`/f/${firmId}/my-projects`} className="underline underline-offset-4">
            My projects
          </Link>
        </p>
      </div>
    )
  }

  const summary = await getDashboardSummary(db, firmId)
  const isAdmin = role === 'admin'

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">{firmName} dashboard</h1>

      {!summary.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {summary.error}
        </p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div className="rounded border p-3">
              <dt className="text-muted-foreground">Active consultants</dt>
              <dd className="text-2xl font-semibold">{summary.data.consultants}</dd>
            </div>
            <div className="rounded border p-3">
              <dt className="text-muted-foreground">Active clients</dt>
              <dd className="text-2xl font-semibold">{summary.data.clients}</dd>
            </div>
            <div className="rounded border p-3">
              <dt className="text-muted-foreground">Active projects</dt>
              <dd className="text-2xl font-semibold">{summary.data.projects}</dd>
            </div>
          </dl>

          <h2 className="mt-8 text-lg font-medium">Finish setup</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {[
              { label: 'Add your firm logo', done: summary.data.hasLogo, href: isAdmin ? `/f/${firmId}/settings` : null },
              { label: 'Add a client', done: summary.data.clients > 0, href: `/f/${firmId}/clients` },
              { label: 'Add a project', done: summary.data.projects > 0, href: `/f/${firmId}/projects` },
              { label: 'Assign a consultant to a project', done: summary.data.assignments > 0, href: `/f/${firmId}/projects` },
            ].map((item) => (
              <li key={item.label}>
                {item.href ? (
                  <Link href={item.href} className="underline underline-offset-4">
                    {item.label}
                  </Link>
                ) : (
                  <span>{item.label}</span>
                )}
                <span className="ml-2 text-muted-foreground">{item.done ? '(Done)' : '(Not done)'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
