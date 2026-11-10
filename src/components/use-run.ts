'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { FieldErrors, FormResult } from '@/lib/form'

export const SOMETHING_WENT_WRONG = 'Something went wrong. Please try again.'

/**
 * Runs a server action, keeps its result for inline errors, and refreshes the page on success.
 * A thrown error (network, body limit, server crash) becomes an inline error, not a crash.
 */
export function useRun() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<FormResult<unknown> | null>(null)

  const run = (fn: () => Promise<FormResult<unknown>>, onOk?: () => void) =>
    startTransition(async () => {
      let r: FormResult<unknown>
      try {
        r = await fn()
      } catch (e) {
        console.error('action failed', e)
        r = { ok: false, error: SOMETHING_WENT_WRONG }
      }
      setResult(r)
      if (r.ok) {
        router.refresh()
        onOk?.()
      }
    })

  const errors: FieldErrors = result && !result.ok ? (result.fieldErrors ?? {}) : {}
  const error = result && !result.ok ? result.error : null
  return { pending, run, errors, error, router }
}
