import type { User } from '@supabase/supabase-js'
import { safeNext } from '@/lib/auth/safe-next'

/**
 * Where a user goes right after an email link signs them in: set a password first if they
 * have never chosen one, otherwise the (same-origin) `next` path or `/`.
 */
export function postLoginPath(user: User | null, next: string | null): string {
  if (user?.user_metadata?.password_set !== true) return '/auth/set-password'
  return safeNext(next)
}
