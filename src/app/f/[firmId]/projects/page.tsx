import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import { listClients } from '@/modules/clients/data'
import { listProjects } from '@/modules/projects/data'
import { ProjectForm } from './project-forms'

const STATUS_LABEL = { active: 'Active', on_hold: 'On hold', closed: 'Closed' } as const

export default async function ProjectsPage({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const [projects, clients] = await Promise.all([listProjects(db, firmId), listClients(db, firmId)])

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Projects</h1>

      {!projects.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {projects.error}
        </p>
      ) : projects.data.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No projects yet.</p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <caption className="sr-only">Projects</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2 pr-4 font-medium">
                Project
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Client
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Code
              </th>
              <th scope="col" className="py-2 font-medium">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {projects.data.map((p) => (
              <tr key={p.id} className="border-b">
                <th scope="row" className="py-2 pr-4 font-normal">
                  <Link href={`/f/${firmId}/projects/${p.id}`} className="underline underline-offset-4">
                    {p.name}
                  </Link>
                </th>
                <td className="py-2 pr-4">{p.clientName}</td>
                <td className="py-2 pr-4">{p.code ?? ''}</td>
                <td className="py-2">{STATUS_LABEL[p.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-8 text-lg font-medium">Add a project</h2>
      {clients.ok && clients.data.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Add a client first, then create projects for them.
        </p>
      ) : (
        <ProjectForm firmId={firmId} clients={clients.ok ? clients.data.map((c) => ({ id: c.id, name: c.name })) : []} />
      )}
    </div>
  )
}
