import type { SupabaseClient } from '@supabase/supabase-js'
import { mapDbError } from '@/lib/db-errors'
import type { ConsultantType } from '@/lib/db-types'
import { isIsoDate, todayIso } from '@/lib/domain/dates'
import { parseMoney } from '@/lib/domain/money'
import { rateOn } from '@/lib/domain/rates'
import { fail, ok, type Result } from '@/lib/result'

const DENIED = "You don't have permission to do that."
const BAD_DATE = 'Enter a valid start date.'

export type ConsultantInput = {
  name: string
  email: string
  type: ConsultantType
  vendorId: string | null
  initialHourlyCost?: string
  initialCostFrom?: string
}

export type ConsultantUpdate = Omit<ConsultantInput, 'initialHourlyCost' | 'initialCostFrom'>

export type CostRate = { id: string; hourlyCost: string; effectiveFrom: string }

export type ConsultantRow = {
  id: string
  name: string
  email: string
  type: ConsultantType
  vendorId: string | null
  vendorName: string | null
  active: boolean
  hasLogin: boolean
  currentCost: string | null
}

export type ConsultantDetail = Omit<ConsultantRow, 'currentCost'> & { costRates: CostRate[] }

type RateRow = { id: string; hourly_cost: number | string; effective_from: string }
type VendorJoin = { name: string } | { name: string }[] | null

// numeric(12,2) arrives as a JSON number; render it back as a canonical 2-dp string (no arithmetic).
const moneyString = (v: number | string): string => Number(v).toFixed(2)

const vendorName = (v: VendorJoin): string | null => (Array.isArray(v) ? v[0]?.name : v?.name) ?? null

function toRates(rows: RateRow[] | null): CostRate[] {
  return (rows ?? [])
    .map((r) => ({ id: r.id, hourlyCost: moneyString(r.hourly_cost), effectiveFrom: r.effective_from }))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0))
}

type ConsultantDbRow = {
  id: string
  name: string
  email: string
  type: ConsultantType
  vendor_id: string | null
  user_id: string | null
  active: boolean
  vendors: VendorJoin
  consultant_cost_rates: RateRow[] | null
}

const SELECT =
  'id, name, email, type, vendor_id, user_id, active, vendors(name), consultant_cost_rates(id, hourly_cost, effective_from)'

function toRow(c: ConsultantDbRow) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    type: c.type,
    vendorId: c.vendor_id,
    vendorName: vendorName(c.vendors),
    active: c.active,
    hasLogin: c.user_id !== null,
  }
}

export async function listConsultants(
  db: SupabaseClient,
  firmId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<Result<ConsultantRow[]>> {
  let q = db.from('consultants').select(SELECT).eq('firm_id', firmId).order('name')
  if (!opts.includeInactive) q = q.eq('active', true)
  const { data, error } = await q
  if (error) return fail(mapDbError(error))

  const today = todayIso()
  return ok(
    ((data ?? []) as unknown as ConsultantDbRow[]).map((c) => {
      const current = rateOn(
        toRates(c.consultant_cost_rates).map((r) => ({ ...r, rate: r.hourlyCost })),
        today,
      )
      return { ...toRow(c), currentCost: current?.rate ?? null }
    }),
  )
}

export async function getConsultant(
  db: SupabaseClient,
  firmId: string,
  id: string,
): Promise<Result<ConsultantDetail>> {
  const { data, error } = await db.from('consultants').select(SELECT).eq('firm_id', firmId).eq('id', id).maybeSingle()
  if (error) return fail(mapDbError(error))
  if (!data) return fail('Consultant not found.')
  const c = data as unknown as ConsultantDbRow
  return ok({ ...toRow(c), costRates: toRates(c.consultant_cost_rates) })
}

function parseRate(hourlyCost: string, effectiveFrom: string): Result<{ hourlyCost: string; effectiveFrom: string }> {
  const money = parseMoney(hourlyCost)
  if (!money.ok) return money
  if (!isIsoDate(effectiveFrom)) return fail(BAD_DATE)
  return ok({ hourlyCost: money.data, effectiveFrom })
}

export async function createConsultant(
  db: SupabaseClient,
  firmId: string,
  input: ConsultantInput,
): Promise<Result<{ id: string }>> {
  // Validate the initial rate completely before anything is inserted.
  const cost = input.initialHourlyCost?.trim() ?? ''
  const from = input.initialCostFrom?.trim() ?? ''
  let rate: { hourlyCost: string; effectiveFrom: string } | null = null
  if (cost !== '' || from !== '') {
    const parsed = parseRate(cost, from)
    if (!parsed.ok) return parsed
    rate = parsed.data
  }

  const { data, error } = await db
    .from('consultants')
    .insert({
      firm_id: firmId,
      name: input.name.trim(),
      email: input.email.trim(),
      type: input.type,
      vendor_id: input.vendorId,
    })
    .select('id')
    .single()
  if (error || !data) return fail(mapDbError(error))
  const id = data.id as string

  if (rate) {
    const added = await addCostRate(db, firmId, id, rate)
    if (!added.ok) {
      // No half-created consultant.
      const { error: delErr } = await db.from('consultants').delete().eq('firm_id', firmId).eq('id', id)
      if (delErr) console.error('rollback of consultant failed', delErr)
      return added
    }
  }
  return ok({ id })
}

export async function updateConsultant(
  db: SupabaseClient,
  firmId: string,
  id: string,
  input: ConsultantUpdate,
): Promise<Result<void>> {
  const { data, error } = await db
    .from('consultants')
    .update({
      name: input.name.trim(),
      email: input.email.trim(),
      type: input.type,
      vendor_id: input.vendorId,
    })
    .eq('firm_id', firmId)
    .eq('id', id)
    .select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}

export async function setConsultantActive(
  db: SupabaseClient,
  firmId: string,
  id: string,
  active: boolean,
): Promise<Result<void>> {
  const { data, error } = await db
    .from('consultants')
    .update({ active })
    .eq('firm_id', firmId)
    .eq('id', id)
    .select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}

export async function addCostRate(
  db: SupabaseClient,
  firmId: string,
  consultantId: string,
  input: { hourlyCost: string; effectiveFrom: string },
): Promise<Result<{ id: string }>> {
  const parsed = parseRate(input.hourlyCost, input.effectiveFrom)
  if (!parsed.ok) return parsed
  const { data, error } = await db
    .from('consultant_cost_rates')
    .insert({
      firm_id: firmId,
      consultant_id: consultantId,
      hourly_cost: parsed.data.hourlyCost,
      effective_from: parsed.data.effectiveFrom,
    })
    .select('id')
    .single()
  if (error || !data) return fail(mapDbError(error))
  return ok({ id: data.id as string })
}

export async function deleteCostRate(db: SupabaseClient, firmId: string, rateId: string): Promise<Result<void>> {
  const { data, error } = await db
    .from('consultant_cost_rates')
    .delete()
    .eq('firm_id', firmId)
    .eq('id', rateId)
    .select('id')
  if (error) return fail(mapDbError(error))
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}
