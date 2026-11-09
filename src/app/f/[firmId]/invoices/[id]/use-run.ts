'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { FieldErrors, FormResult } from '@/lib/form'

/** Runs a server action, keeps its result for inline errors, and refreshes the page on success. */
export function useRun() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<FormResult<unknown> | null>(null)

  const run = (fn: () => Promise<FormResult<unknown>>, onOk?: () => void) =>
    startTransition(async () => {
      const r = await fn()
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
