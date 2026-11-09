import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import { fail, ok, type Result } from '@/lib/result'

const DENIED = "You don't have permission to do that."

export type ClientInput = {
  name: string
  billingContactName?: string
  billingEmail?: string
  billingPhone?: string
  billingAddress?: string
}

export type ClientRow = {
  id: string
  name: string
  billingContactName: string | null
  billingEmail: string | null
  billingPhone: string | null
  billingAddress: string | null
  active: boolean
}

const blankToNull = (v: string | undefined): string | null => {
  const t = v?.trim()
  return t ? t : null
}

function toColumns(input: ClientInput) {
  return {
    name: input.name.trim(),
    billing_contact_name: blankToNull(input.billingContactName),
    billing_email: blankToNull(input.billingEmail),
    billing_phone: blankToNull(input.billingPhone),
    billing_address: blankToNull(input.billingAddress),
  }
}

export async function listClients(
  db: SupabaseClient,
  firmId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<Result<ClientRow[]>> {
  let q = db
    .from('clients')
    .select('id, name, billing_contact_name, billing_email, billing_phone, billing_address, active')
    .eq('firm_id', firmId)
    .order('name')
  if (!opts.includeInactive) q = q.eq('active', true)
  const { data, error } = await q
  if (error) return fail(mapDbError(error))
  return ok(
    (data ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      billingContactName: c.billing_contact_name as string | null,
      billingEmail: c.billing_email as string | null,
      billingPhone: c.billing_phone as string | null,
      billingAddress: c.billing_address as string | null,
      active: c.active as boolean,
    })),
  )
}

export async function createClient(
  db: SupabaseClient,
  firmId: string,
  input: ClientInput,
): Promise<Result<{ id: string }>> {
  const { data, error } = await db
    .from('clients')
    .insert({ firm_id: firmId, ...toColumns(input) })
    .select('id')
    .single()
  if (error || !data) return fail(mapDbError(error))
  return ok({ id: data.id as string })
}

export async function updateClient(
  db: SupabaseClient,
  firmId: string,
  id: string,
  input: ClientInput,
): Promise<Result<void>> {
  const { data, error } = await db
    .from('clients')
    .update(toColumns(input))
    .eq('firm_id', firmId)
    .eq('id', id)
    .select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}

export async function setClientActive(
  db: SupabaseClient,
  firmId: string,
  id: string,
  active: boolean,
): Promise<Result<void>> {
  const { data, error } = await db.from('clients').update({ active }).eq('firm_id', firmId).eq('id', id).select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}

export async function deleteClient(db: SupabaseClient, firmId: string, id: string): Promise<Result<void>> {
  const { data, error } = await db.from('clients').delete().eq('firm_id', firmId).eq('id', id).select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}
