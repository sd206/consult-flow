import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import type { Database, FirmRole } from '@/lib/db-types'
import { createServerDb } from '@/lib/supabase/server'

export type UserContext = {
  userId: string
  email: string
  isPlatformOwner: boolean
  db: SupabaseClient<Database>
}

export type FirmContext = {
  userId: string
  email: string
  firmId: string
  role: FirmRole
  firmName: string
  db: SupabaseClient<Database>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function requireUser(): Promise<UserContext> {
  const db = await createServerDb()
  const { data, error } = await db.auth.getUser()
  if (error || !data.user) redirect('/login')

  const { data: isOwner, error: ownerErr } = await db.rpc('is_platform_owner')
  if (ownerErr) console.error('is_platform_owner failed', ownerErr)

  return {
    userId: data.user.id,
    email: data.user.email ?? '',
    isPlatformOwner: isOwner === true,
    db,
  }
}

export async function requireFirmRole(firmId: string, roles: FirmRole[]): Promise<FirmContext> {
  const { userId, email, db } = await requireUser()
  if (!UUID_RE.test(firmId)) notFound()

  const { data, error } = await db
    .from('firm_members')
    .select('role, firms(name)')
    .eq('firm_id', firmId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) console.error('firm membership lookup failed', error)

  // Non-members and insufficient roles are indistinguishable: both 404.
  if (!data || !roles.includes(data.role)) notFound()
  const firm = Array.isArray(data.firms) ? data.firms[0] : data.firms
  if (!firm) notFound()

  return { userId, email, firmId, role: data.role, firmName: firm.name, db }
}
