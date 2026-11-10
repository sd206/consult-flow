'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

export type NavLink = { label: string; href: string }
export type NavEntry = { label: string; href: string } | { label: string; items: NavLink[] }

// Top-level items sit on the navy header: white text, pale teal when selected.
const topClass =
  'rounded-md px-2 py-1 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'
const topActive = 'bg-selected font-semibold text-brand hover:bg-selected'

/** The most specific link matching the current path, so /invoices/unpaid doesn't also light up /invoices. */
function activeHref(pathname: string, entries: NavEntry[]): string | null {
  const hrefs = entries.flatMap((e) => ('items' in e ? e.items.map((i) => i.href) : [e.href]))
  let best: string | null = null
  for (const href of hrefs) {
    const matches = pathname === href || pathname.startsWith(`${href}/`)
    if (matches && (best === null || href.length > best.length)) best = href
  }
  return best
}

export function FirmNav({ entries, home }: { entries: NavEntry[]; home: string }) {
  const pathname = usePathname()
  const [open, setOpen] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)
  // The dashboard link only counts as active on the dashboard itself.
  const current = pathname === home ? home : activeHref(pathname, entries.filter((e) => !('href' in e && e.href === home)))

  // Close on navigation.
  useEffect(() => setOpen(null), [pathname])

  // Close on a click outside the menu.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <nav aria-label="Firm" className="mt-2" ref={navRef}>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        {entries.map((entry) =>
          'items' in entry ? (
            <NavGroup
              key={entry.label}
              label={entry.label}
              items={entry.items}
              current={current}
              isOpen={open === entry.label}
              onToggle={() => setOpen((o) => (o === entry.label ? null : entry.label))}
              onClose={() => setOpen(null)}
            />
          ) : (
            <li key={entry.label}>
              <Link
                href={entry.href}
                aria-current={current === entry.href ? 'page' : undefined}
                className={`${topClass} ${current === entry.href ? topActive : ''}`}
              >
                {entry.label}
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  )
}

function NavGroup({
  label,
  items,
  current,
  isOpen,
  onToggle,
  onClose,
}: {
  label: string
  items: NavLink[]
  current: string | null
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const menuId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const active = items.some((i) => i.href === current)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault()
      onClose()
      buttonRef.current?.focus()
    }
  }

  return (
    <li className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={onToggle}
        className={`${topClass} inline-flex items-center gap-1 ${active ? topActive : ''}`}
      >
        {label}
        <span aria-hidden="true" className="text-xs">
          {isOpen ? '▴' : '▾'}
        </span>
      </button>
      <ul
        id={menuId}
        hidden={!isOpen}
        className="absolute left-0 top-full z-20 mt-1 min-w-48 rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
      >
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={current === item.href ? 'page' : undefined}
              className={`block px-3 py-1.5 hover:bg-selected focus-visible:bg-selected focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
                current === item.href ? 'bg-selected font-semibold text-primary' : ''
              }`}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  )
}
