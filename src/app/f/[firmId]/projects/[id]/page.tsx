import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFirmRole } from '@/lib/auth/context'
import { todayIso } from '@/lib/domain/dates'
import { formatMoney, subtractMoney } from '@/lib/domain/money'
import { rateOn } from '@/lib/domain/rates'
import { listClients } from '@/modules/clients/data'
import { listConsultants } from '@/modules/consultants/data'
import { getFirm } from '@/modules/firms/data'
import { getProject } from '@/modules/projects/data'
import { AssignmentForm, ChangeRateForm, EndAssignmentForm, ProjectForm } from '../project-forms'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUS_LABEL = { active: 'Active', on_hold: 'On hold', closed: 'Closed' } as const

export default async function ProjectPage({ params }: { params: Promise<{ firmId: string; id: string }> }) {
  const { firmId, id } = await params
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  if (!UUID_RE.test(id)) notFound()

  const [project, clients, consultants, firm] = await Promise.all([
    getProject(db, firmId, id),
    listClients(db, firmId, { includeInactive: true }),
    listConsultants(db, firmId),
    getFirm(db, firmId),
  ])
  if (!project.ok) notFound()
  const p = project.data
  const currency = firm.ok ? firm.data.currency : 'USD'
  const today = todayIso()
  const money = (v: string) => formatMoney(v, currency)

  return (
    <div className="max-w-4xl">
      <p className="text-sm">
        <Link href={`/f/${firmId}/projects`} className="underline underline-offset-4">
          Back to projects
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">{p.name}</h1>
      <p className="text-sm text-muted-foreground">
        {p.clientName}
        {p.code ? ` · ${p.code}` : ''} · {STATUS_LABEL[p.status]}
      </p>

      <h2 className="mt-8 text-lg font-medium">Details</h2>
      <ProjectForm
        firmId={firmId}
        clients={clients.ok ? clients.data.map((c) => ({ id: c.id, name: c.name })) : []}
        project={{
          id: p.id,
          clientId: p.clientId,
          name: p.name,
          code: p.code,
          status: p.status,
          startDate: p.startDate,
          endDate: p.endDate,
        }}
      />

      <h2 className="mt-8 text-lg font-medium">Assignments</h2>
      {p.assignments.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No consultants assigned yet.</p>
      ) : (
        <table className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">Consultant assignments, newest first</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-4 font-medium">
                Consultant
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Client rate
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Period
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Current cost
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Margin per hour
              </th>
              <th scope="col" className="py-2 font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {p.assignments.map((a) => {
              const label = `${a.consultantName} from ${a.effectiveFrom}`
              const isCurrent = rateOn([{ rate: a.clientRate, ...a }], today) !== null
              return (
                <tr key={a.id} className="border-b align-top">
                  <th scope="row" className="py-2 pr-4 font-normal">
                    {a.consultantName}
                  </th>
                  <td className="py-2 pr-4">{money(a.clientRate)}</td>
                  <td className="py-2 pr-4">
                    {a.effectiveFrom} to {a.effectiveTo ?? 'open'}
                  </td>
                  <td className="py-2 pr-4">{a.currentCost !== null ? money(a.currentCost) : '—'}</td>
                  <td className="py-2 pr-4">
                    {isCurrent && a.currentCost !== null ? money(subtractMoney(a.clientRate, a.currentCost)) : '—'}
                  </td>
                  <td className="py-2">
                    <details>
                      <summary className="cursor-pointer text-sm underline-offset-4 hover:underline">
                        Change rate<span className="sr-only"> for {label}</span>
                      </summary>
                      <ChangeRateForm firmId={firmId} projectId={p.id} assignmentId={a.id} label={label} />
                    </details>
                    {a.effectiveTo === null && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-sm underline-offset-4 hover:underline">
                          End<span className="sr-only"> {label}</span>
                        </summary>
                        <EndAssignmentForm firmId={firmId} projectId={p.id} assignmentId={a.id} label={label} />
                      </details>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <h3 className="mt-6 text-base font-medium">Assign consultant</h3>
      <AssignmentForm
        firmId={firmId}
        projectId={p.id}
        consultants={consultants.ok ? consultants.data.map((c) => ({ id: c.id, name: c.name })) : []}
      />
    </div>
  )
}
