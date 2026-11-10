import type { SupabaseClient } from '@supabase/supabase-js'
import { listCategories } from '@/modules/expense-categories/data'
import { getFirm } from '@/modules/firms/data'
import { listClients } from '@/modules/clients/data'
import { listProjects } from '@/modules/projects/data'
import type { CategoryOption, ClientOption, ProjectOption } from './expense-form'

export type FormOptions = {
  categories: CategoryOption[]
  clients: ClientOption[]
  projects: ProjectOption[]
  currency: string
  /** First load error, if any option list could not be read. */
  error: string | null
}

/** Everything the expense form and the list filters need, all categories/clients/projects included. */
export async function loadFormOptions(db: SupabaseClient, firmId: string): Promise<FormOptions> {
  const [cats, clients, projects, firm] = await Promise.all([
    listCategories(db, firmId),
    listClients(db, firmId, { includeInactive: true }),
    listProjects(db, firmId),
    getFirm(db, firmId),
  ])
  const failed = [cats, clients, projects].find((r) => !r.ok)
  return {
    categories: cats.ok ? cats.data.map((c) => ({ id: c.id, name: c.name, active: c.active })) : [],
    clients: clients.ok ? clients.data.map((c) => ({ id: c.id, name: c.name })) : [],
    projects: projects.ok
      ? projects.data.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId, clientName: p.clientName }))
      : [],
    currency: firm.ok ? firm.data.currency : 'USD',
    error: failed && !failed.ok ? failed.error : null,
  }
}
