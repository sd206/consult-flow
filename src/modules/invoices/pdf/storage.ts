import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fail, type Result } from '@/lib/result'

/** Stub: Task 6 replaces this with real PDF rendering and storage. */
export async function generateAndStorePdf(
  _db: SupabaseClient,
  _firmId: string,
  _invoiceId: string,
): Promise<Result<{ path: string }>> {
  void [_db, _firmId, _invoiceId]
  return fail('PDF rendering is not set up yet.')
}
