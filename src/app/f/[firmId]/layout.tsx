import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import type { FirmRole } from '@/lib/db-types'

type NavItem = { label: string; path: string; roles: FirmRole[] }

const ALL: FirmRole[] = ['admin', 'manager', 'consultant']
const MANAGERS: FirmRole[] = ['admin', 'manager']

const NAV: NavItem[] = [
  { label: 'Dashboard', path: '', roles: ALL },
  { label: 'My projects', path: '/my-projects', roles: ALL },
  { label: 'My timesheet', path: '/timesheet', roles: ALL },
  { label: 'Timesheets', path: '/timesheets', roles: MANAGERS },
  { label: 'Invoices', path: '/invoices', roles: MANAGERS },
  { label: 'Unpaid', path: '/invoices/unpaid', roles: MANAGERS },
  { label: 'Expenses', path: '/expenses', roles: MANAGERS },
  { label: 'Reports', path: '/reports/pnl', roles: MANAGERS },
  { label: 'Clients', path: '/clients', roles: MANAGERS },
  { label: 'Projects', path: '/projects', roles: MANAGERS },
  { label: 'Consultants', path: '/consultants', roles: MANAGERS },
  { label: 'Vendors', path: '/vendors', roles: MANAGERS },
  { label: 'Users', path: '/users', roles: ['admin'] },
  { label: 'Settings', path: '/settings', roles: ['admin'] },
]

export default async function FirmLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ firmId: string }>
}) {
  const { firmId } = await params
  const { role, firmName } = await requireFirmRole(firmId, ALL)
  const base = `/f/${firmId}`

  return (
    <div className="min-h-screen">
      <header className="border-b px-6 py-3">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">{firmName}</span>
          <span className="text-sm text-muted-foreground">{role}</span>
        </div>
        <nav aria-label="Firm" className="mt-2">
          <ul className="flex flex-wrap gap-4 text-sm">
            {NAV.filter((n) => n.roles.includes(role)).map((n) => (
              <li key={n.label}>
                <Link
                  href={`${base}${n.path}`}
                  className="rounded underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  )
}
