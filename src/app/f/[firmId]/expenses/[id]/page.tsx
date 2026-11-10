import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFirmRole } from '@/lib/auth/context'
import { getExpense } from '@/modules/expenses/data'
import { DeleteExpenseButton, ExpenseForm, ReceiptsSection } from '../expense-form'
import { loadFormOptions } from '../form-data'

export default async function ExpensePage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string; id: string }>
  searchParams: Promise<{ added?: string | string[]; fileWarning?: string | string[] }>
}) {
  const { firmId, id } = await params
  const sp = await searchParams
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const [res, opts] = await Promise.all([getExpense(db, firmId, id), loadFormOptions(db, firmId)])
  if (!res.ok) notFound()
  const e = res.data
  const added = sp.added === '1'
  const fileWarning = typeof sp.fileWarning === 'string' ? sp.fileWarning.slice(0, 500) : null

  return (
    <div className="max-w-5xl">
      <Link href={`/f/${firmId}/expenses`} className="text-sm underline underline-offset-4">
        Expenses
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Expense</h1>
      {added && (
        <p role="status" className="mt-3 text-sm">
          Expense added.
        </p>
      )}
      {fileWarning && (
        <p role="status" className="mt-3 text-sm">
          {fileWarning}
        </p>
      )}
      {opts.error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {opts.error}
        </p>
      )}
      <ExpenseForm
        firmId={firmId}
        categories={opts.categories}
        clients={opts.clients}
        projects={opts.projects}
        expense={{
          id: e.id,
          spentOn: e.spentOn,
          categoryId: e.categoryId,
          payee: e.payee,
          amount: e.amount,
          clientId: e.clientId,
          projectId: e.projectId,
          notes: e.notes,
        }}
      />
      <ReceiptsSection
        firmId={firmId}
        expenseId={e.id}
        receipts={e.attachments.map((a) => ({ id: a.id, fileName: a.fileName }))}
      />
      <DeleteExpenseButton firmId={firmId} expenseId={e.id} amount={e.amount} currency={opts.currency} />
    </div>
  )
}
