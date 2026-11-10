import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import { ExpenseForm } from '../expense-form'
import { loadFormOptions } from '../form-data'

export default async function NewExpensePage({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const opts = await loadFormOptions(db, firmId)

  return (
    <div className="max-w-5xl">
      <Link href={`/f/${firmId}/expenses`} className="text-sm underline underline-offset-4">
        Expenses
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">New expense</h1>
      {opts.error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {opts.error}
        </p>
      )}
      <ExpenseForm firmId={firmId} categories={opts.categories} clients={opts.clients} projects={opts.projects} />
    </div>
  )
}
