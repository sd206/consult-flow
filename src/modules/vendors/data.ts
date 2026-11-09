import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import { fail, ok, type Result } from '@/lib/result'

const DENIED = "You don't have permission to do that."

export type VendorInput = {
  name: string
  contactName?: string
  email?: string
  phone?: string
  address?: string
}

export type VendorRow = {
  id: string
  name: string
  contactName: string | null
  email: string | null
  phone: string | null
  address: string | null
}

const blankToNull = (v: string | undefined): string | null => {
  const t = v?.trim()
  return t ? t : null
}

function toColumns(input: VendorInput) {
  return {
    name: input.name.trim(),
    contact_name: blankToNull(input.contactName),
    email: blankToNull(input.email),
    phone: blankToNull(input.phone),
    address: blankToNull(input.address),
  }
}

export async function listVendors(db: SupabaseClient, firmId: string): Promise<Result<VendorRow[]>> {
  const { data, error } = await db
    .from('vendors')
    .select('id, name, contact_name, email, phone, address')
    .eq('firm_id', firmId)
    .order('name')
  if (error) return fail(mapDbError(error))
  return ok(
    (data ?? []).map((v) => ({
      id: v.id as string,
      name: v.name as string,
      contactName: v.contact_name as string | null,
      email: v.email as string | null,
      phone: v.phone as string | null,
      address: v.address as string | null,
    })),
  )
}

export async function createVendor(
  db: SupabaseClient,
  firmId: string,
  input: VendorInput,
): Promise<Result<{ id: string }>> {
  const { data, error } = await db
    .from('vendors')
    .insert({ firm_id: firmId, ...toColumns(input) })
    .select('id')
    .single()
  if (error || !data) return fail(mapDbError(error))
  return ok({ id: data.id as string })
}

export async function updateVendor(
  db: SupabaseClient,
  firmId: string,
  id: string,
  input: VendorInput,
): Promise<Result<void>> {
  const { data, error } = await db
    .from('vendors')
    .update(toColumns(input))
    .eq('firm_id', firmId)
    .eq('id', id)
    .select('id')
  if (error) return fail(mapDbError(error))
  // RLS filters rows silently: zero rows means not allowed or no such vendor.
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}

export async function deleteVendor(db: SupabaseClient, firmId: string, id: string): Promise<Result<void>> {
  const { data, error } = await db.from('vendors').delete().eq('firm_id', firmId).eq('id', id).select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}
