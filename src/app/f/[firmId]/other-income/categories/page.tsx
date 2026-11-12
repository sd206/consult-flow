import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import { listCategories } from '@/modules/other-income/categories'
import { AddCategoryForm, CategoryRow } from './category-forms'

const th = 'py-2 pr-4 font-medium'

export default async function CategoriesPage({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const list = await listCategories(db, firmId)

  return (
    <div className="max-w-3xl">
      <Link href={`/f/${firmId}/other-income`} className="text-sm underline underline-offset-4">
        Other income
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Other income categories</h1>

      {!list.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {list.error}
        </p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              {['Name', 'Status', 'Entries'].map((h) => (
                <th key={h} scope="col" className={th}>
                  {h}
                </th>
              ))}
              <th scope="col" className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((c) => (
              <CategoryRow key={c.id} firmId={firmId} category={c} />
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-8 text-lg font-semibold">Add category</h2>
      <AddCategoryForm firmId={firmId} />
    </div>
  )
}
