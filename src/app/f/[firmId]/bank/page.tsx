import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import { listAccounts } from '@/modules/bank/data'

const th = 'py-2 pr-4 font-medium'
const td = 'py-2 pr-4 align-top'

export default async function BankAccountsPage({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const list = await listAccounts(db, firmId)

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Bank accounts</h1>
        <Link
          href={`/f/${firmId}/bank/new`}
          className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Add account
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload statements (OFX, QFX or CSV) from your bank and credit-card accounts, then review each transaction.
      </p>

      {!list.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {list.error}
        </p>
      ) : list.data.length === 0 ? (
        <p className="mt-6 text-sm">No accounts yet. Add your first bank or credit-card account to start importing.</p>
      ) : (
        <table className="mt-6 w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              {['Account', 'Type', 'To review', 'Status'].map((h) => (
                <th key={h} scope="col" className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.data.map((a) => (
              <tr key={a.id} className="border-b">
                <th scope="row" className={`${td} font-normal`}>
                  <Link href={`/f/${firmId}/bank/${a.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                    {a.name}
                  </Link>
                  {a.last4 && <span className="text-muted-foreground"> ····{a.last4}</span>}
                </th>
                <td className={td}>{a.kind === 'bank' ? 'Bank' : 'Credit card'}</td>
                <td className={td}>{a.newCount === 0 ? '—' : a.newCount}</td>
                <td className={td}>{a.active ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
