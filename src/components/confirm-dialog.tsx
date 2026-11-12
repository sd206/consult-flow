'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

export type ConfirmOptions = {
  /** Label of the button that goes ahead, e.g. "Issue invoice" or "Delete". */
  confirmLabel?: string
  destructive?: boolean
}

type Request = ConfirmOptions & { message: string; resolve: (ok: boolean) => void }

let open: ((r: Request) => void) | null = null

/**
 * Asks the user to confirm in an in-page dialog and resolves true when they go ahead.
 * Replaces window.confirm, which some embedded browsers never show (the click then did nothing).
 */
export function askConfirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  if (!open) return Promise.resolve(window.confirm(message))
  const show = open
  return new Promise((resolve) => show({ ...options, message, resolve }))
}

/** Mounted once in the root layout; renders the dialog that askConfirm opens. */
export function ConfirmDialogHost() {
  const [req, setReq] = useState<Request | null>(null)
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const messageId = useId()

  useEffect(() => {
    open = (r) =>
      setReq((prev) => {
        prev?.resolve(false)
        return r
      })
    return () => {
      open = null
    }
  }, [])

  useEffect(() => {
    const d = ref.current
    if (req && d && !d.open) d.showModal()
  }, [req])

  const finish = (ok: boolean) => {
    req?.resolve(ok)
    setReq(null)
    ref.current?.close()
  }

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(e) => {
        e.preventDefault()
        finish(false)
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border bg-background p-5 text-foreground shadow-lg backdrop:bg-black/40"
    >
      {req && (
        <>
          <h2 id={titleId} className="text-base font-semibold">
            Please confirm
          </h2>
          <p id={messageId} data-testid="confirm-message" className="mt-2 text-sm">
            {req.message}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" autoFocus onClick={() => finish(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              data-testid="confirm-ok"
              variant={req.destructive ? 'destructive' : 'default'}
              onClick={() => finish(true)}
            >
              {req.confirmLabel ?? 'Confirm'}
            </Button>
          </div>
        </>
      )}
    </dialog>
  )
}
