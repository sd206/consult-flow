'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { signOutAction } from '@/lib/auth/actions'

/** Top-right menu: who is signed in, Change password, Sign out. */
export function AccountMenu({ email, role }: { email: string; role?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md px-2 py-1 text-sm text-white/85 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        Account<span className="sr-only">: {email}</span>
        {role && <span className="ml-1 text-white/60">· {role}</span>}
        <span aria-hidden className="ml-1">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border bg-card p-1 text-sm text-foreground shadow-lg">
          <p className="truncate px-3 py-2 text-muted-foreground" title={email}>
            {email}
          </p>
          <Link
            href="/auth/set-password?change=1"
            className="block rounded-md px-3 py-2 hover:bg-selected"
            onClick={() => setOpen(false)}
          >
            Change password
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="block w-full rounded-md px-3 py-2 text-left hover:bg-selected">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
