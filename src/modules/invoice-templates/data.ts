import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import type { InvoiceLayout } from '@/lib/db-types'
import { fail, ok, type Result } from '@/lib/result'
import { parseTemplateOptions, type TemplateInput, type TemplateOptions } from './schemas'

const DENIED = "You don't have permission to do that."
const NOT_FOUND = 'Template not found.'
const COLUMNS = 'id, name, base_layout, options, is_default'

export type TemplateRow = {
  id: string
  name: string
  baseLayout: InvoiceLayout
  options: TemplateOptions
  isDefault: boolean
}

type DbRow = { id: string; name: string; base_layout: InvoiceLayout; options: unknown; is_default: boolean }

const toRow = (r: DbRow): TemplateRow => ({
  id: r.id,
  name: r.name,
  baseLayout: r.base_layout,
  options: parseTemplateOptions(r.options),
  isDefault: r.is_default,
})

export async function listTemplates(db: SupabaseClient, firmId: string): Promise<Result<TemplateRow[]>> {
  const { data, error } = await db
    .from('invoice_templates')
    .select(COLUMNS)
    .eq('firm_id', firmId)
    .order('is_default', { ascending: false })
    .order('name')
  if (error) return fail(mapDbError(error))
  return ok(((data ?? []) as DbRow[]).map(toRow))
}

export async function getTemplate(db: SupabaseClient, firmId: string, id: string): Promise<Result<TemplateRow>> {
  const { data, error } = await db.from('invoice_templates').select(COLUMNS).eq('firm_id', firmId).eq('id', id).maybeSingle()
  if (error) return fail(mapDbError(error))
  if (!data) return fail(NOT_FOUND)
  return ok(toRow(data as DbRow))
}

export async function createTemplate(
  db: SupabaseClient,
  firmId: string,
  input: TemplateInput,
): Promise<Result<{ id: string }>> {
  const { data, error } = await db
    .from('invoice_templates')
    .insert({ firm_id: firmId, name: input.name, base_layout: input.baseLayout, options: input.options, is_default: false })
    .select('id')
    .single()
  if (error || !data) return fail(mapDbError(error))
  return ok({ id: (data as { id: string }).id })
}

export async function updateTemplate(
  db: SupabaseClient,
  firmId: string,
  id: string,
  input: TemplateInput,
): Promise<Result<void>> {
  const { data, error } = await db
    .from('invoice_templates')
    .update({ name: input.name, base_layout: input.baseLayout, options: input.options })
    .eq('firm_id', firmId)
    .eq('id', id)
    .select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}

export async function deleteTemplate(db: SupabaseClient, firmId: string, id: string): Promise<Result<void>> {
  const { data, error } = await db.from('invoice_templates').delete().eq('firm_id', firmId).eq('id', id).select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}

export async function setDefaultTemplate(db: SupabaseClient, firmId: string, id: string): Promise<Result<void>> {
  // Verify the template belongs to this firm before the (id-only) RPC runs.
  const found = await getTemplate(db, firmId, id)
  if (!found.ok) return found
  const { error } = await db.rpc('set_default_template', { p_template: id })
  if (error) return fail(mapDbError(error))
  return ok(undefined)
}
