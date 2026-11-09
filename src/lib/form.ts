import type { z } from 'zod'
import type { Result } from '@/lib/result'

export type FieldErrors = Partial<Record<string, string>>
export type FormResult<T = void> = Result<T> & { fieldErrors?: FieldErrors }

export const CHECK_FIELDS = 'Check the highlighted fields.'

/** Read a form value as a string ('' when absent or a file). */
export function str(fd: FormData, key: string): string {
  const v = fd.get(key)
  return typeof v === 'string' ? v : ''
}

/** First message per top-level field of a Zod error. */
export function fieldErrorsOf(error: z.ZodError): FormResult<never> {
  const fieldErrors: FieldErrors = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '')
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return { ok: false, error: CHECK_FIELDS, fieldErrors }
}
