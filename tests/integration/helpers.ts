import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name}`)
  return v
}

const authOpts = { auth: { persistSession: false, autoRefreshToken: false } }

export function adminDb(): SupabaseClient {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), authOpts)
}

export function anonDb(): SupabaseClient {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), authOpts)
}

export type TestUser = { id: string; email: string; db: SupabaseClient }

export const TEST_PASSWORD = 'test-password-123'

export async function signIn(email: string, password: string): Promise<TestUser> {
  const db = anonDb()
  const { data, error } = await db.auth.signInWithPassword({ email, password })
  if (error || !data.user) throw new Error(`signIn failed: ${error?.message}`)
  return { id: data.user.id, email, db }
}

export async function newUser(label: string): Promise<TestUser> {
  const email = `${label}-${crypto.randomUUID()}@test.local`
  const { data, error } = await adminDb().auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { password_set: true },
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
  return signIn(email, TEST_PASSWORD)
}

export async function newFirm(name = 'Test Firm'): Promise<{
  firmId: string
  admin: TestUser
  manager: TestUser
  consultant: TestUser
}> {
  const db = adminDb()
  const [admin, manager, consultant] = await Promise.all([
    newUser('admin'),
    newUser('manager'),
    newUser('consultant'),
  ])
  const { data: firm, error } = await db.from('firms').insert({ name }).select('id').single()
  if (error || !firm) throw new Error(`firm insert failed: ${error?.message}`)
  const firmId = (firm as { id: string }).id
  const { error: mErr } = await db.from('firm_members').insert([
    { firm_id: firmId, user_id: admin.id, role: 'admin' },
    { firm_id: firmId, user_id: manager.id, role: 'manager' },
    { firm_id: firmId, user_id: consultant.id, role: 'consultant' },
  ])
  if (mErr) throw new Error(`membership insert failed: ${mErr.message}`)
  return { firmId, admin, manager, consultant }
}
