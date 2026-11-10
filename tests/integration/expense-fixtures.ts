import { adminDb } from './helpers'

export const SPENT_ON = '2026-10-15'

async function insertOne<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const { data, error } = await adminDb().from(table).insert(row).select().single()
  if (error || !data) throw new Error(`${table} insert failed: ${error?.message}`)
  return data as T
}

/** Inserts (service role) a client; returns its id. */
export async function insertClient(firmId: string, name = `Client ${crypto.randomUUID()}`): Promise<string> {
  return (await insertOne<{ id: string }>('clients', { firm_id: firmId, name })).id
}

/** Inserts (service role) a project of the client; returns its id. */
export async function insertProject(firmId: string, clientId: string, name = 'Rollout'): Promise<string> {
  return (await insertOne<{ id: string }>('projects', { firm_id: firmId, client_id: clientId, name })).id
}

/** Looks up (service role) a firm's category by name; returns its id. */
export async function categoryId(firmId: string, name: string): Promise<string> {
  const { data, error } = await adminDb()
    .from('expense_categories')
    .select('id')
    .eq('firm_id', firmId)
    .eq('name', name)
    .single()
  if (error || !data) throw new Error(`category lookup failed: ${error?.message}`)
  return (data as { id: string }).id
}

/** The folder an expense's attachments must live in. */
export function expenseAttachmentPath(firmId: string, expenseId: string, name = `${crypto.randomUUID()}.pdf`) {
  return `firms/${firmId}/attachments/expenses/${expenseId}/${name}`
}
