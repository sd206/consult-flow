import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import { AccountForm } from '../account-form'

export default async function NewBankAccountPage({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params
  await requireFirmRole(firmId, ['admin', 'manager'])
  return (
    <div className="max-w-3xl">
      <Link href={`/f/${firmId}/bank`} className="text-sm underline underline-offset-4">
        Bank accounts
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Add account</h1>
      <AccountForm firmId={firmId} />
    </div>
  )
}
