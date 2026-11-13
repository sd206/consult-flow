import { requireFirmRole } from '@/lib/auth/context'
import type { FirmRole } from '@/lib/db-types'
import { FirmNav, type NavEntry } from './firm-nav'

type Item = { label: string; path: string; roles: FirmRole[] }
type Group = { label: string; items: Item[] }

const ALL: FirmRole[] = ['admin', 'manager', 'consultant']
const MANAGERS: FirmRole[] = ['admin', 'manager']
const ADMINS: FirmRole[] = ['admin']

// Top-level menu: Dashboard, then groups. A group is shown only if the role can see at least one item in it.
const NAV: (Item | Group)[] = [
  { label: 'Dashboard', path: '', roles: ALL },
  {
    label: 'Work',
    items: [
      { label: 'My timesheet', path: '/timesheet', roles: ALL },
      { label: 'My projects', path: '/my-projects', roles: ALL },
      { label: 'Timesheet approvals', path: '/timesheets', roles: MANAGERS },
    ],
  },
  {
    label: 'Billing',
    items: [
      { label: 'Invoices', path: '/invoices', roles: MANAGERS },
      { label: 'Unpaid invoices', path: '/invoices/unpaid', roles: MANAGERS },
      { label: 'Payments', path: '/payments', roles: MANAGERS },
      { label: 'Expenses', path: '/expenses', roles: MANAGERS },
      { label: 'Other income', path: '/other-income', roles: MANAGERS },
      { label: 'Bank accounts', path: '/bank', roles: MANAGERS },
    ],
  },
  {
    label: 'Reports',
    items: [
      { label: 'Profit & loss', path: '/reports/pnl', roles: MANAGERS },
      { label: 'Transactions', path: '/reports/transactions', roles: MANAGERS },
    ],
  },
  {
    label: 'Setup',
    items: [
      { label: 'Clients', path: '/clients', roles: MANAGERS },
      { label: 'Projects', path: '/projects', roles: MANAGERS },
      { label: 'Consultants', path: '/consultants', roles: ADMINS },
      { label: 'Vendors', path: '/vendors', roles: MANAGERS },
      { label: 'Users', path: '/users', roles: ADMINS },
      { label: 'Settings', path: '/settings', roles: MANAGERS },
    ],
  },
]

function navFor(role: FirmRole, base: string): NavEntry[] {
  const out: NavEntry[] = []
  for (const entry of NAV) {
    if ('items' in entry) {
      const items = entry.items
        .filter((i) => i.roles.includes(role))
        .map((i) => ({ label: i.label, href: `${base}${i.path}` }))
      if (items.length > 0) out.push({ label: entry.label, items })
    } else if (entry.roles.includes(role)) {
      out.push({ label: entry.label, href: `${base}${entry.path}` })
    }
  }
  return out
}

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
      <header className="bg-brand px-6 py-3 text-brand-foreground">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">{firmName}</span>
          <span className="text-sm text-white/75">{role}</span>
        </div>
        <FirmNav entries={navFor(role, base)} home={base} />
      </header>
      <main className="p-6">{children}</main>
    </div>
  )
}
