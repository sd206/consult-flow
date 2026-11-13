import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import { DEFAULT_TEMPLATE_OPTIONS } from '@/modules/invoice-templates/schemas'
import { getTemplate, listTemplates, type TemplateRow } from '@/modules/invoice-templates/data'
import { TemplateForm, TemplateRowActions } from './template-form'

const LAYOUT_LABEL = { classic: 'Classic', modern: 'Modern', compact: 'Compact' } as const

export default async function TemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>
  searchParams: Promise<{ edit?: string; new?: string }>
}) {
  const { firmId } = await params
  const { edit, new: isNew } = await searchParams
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const list = await listTemplates(db, firmId)

  let editing: TemplateRow | null = null
  let editError: string | null = null
  if (edit) {
    const t = await getTemplate(db, firmId, edit)
    if (t.ok) editing = t.data
    else editError = t.error
  }
  const base = `/f/${firmId}/settings/templates`
  const showForm = !!editing || isNew !== undefined

  return (
    <div className="max-w-2xl">
      <Link href={`/f/${firmId}/settings`} className="text-sm underline underline-offset-4">
        Settings
      </Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoice templates</h1>
        <Link href={`${base}?new=1`} className="text-sm underline underline-offset-4">
          New template
        </Link>
      </div>

      {editError && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {editError}
        </p>
      )}
      {showForm && (
        <TemplateForm
          key={editing?.id ?? 'new'}
          firmId={firmId}
          listHref={base}
          template={editing ?? { id: null, name: '', baseLayout: 'classic', options: DEFAULT_TEMPLATE_OPTIONS }}
        />
      )}

      {!list.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {list.error}
        </p>
      ) : (
        <ul className="mt-6 divide-y rounded-lg border">
          {list.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="flex items-center gap-2">
                <span className="font-medium">{t.name}</span>
                <span className="text-sm text-muted-foreground">{LAYOUT_LABEL[t.baseLayout]}</span>
                {t.isDefault && (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">Default</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Link href={`${base}?edit=${t.id}`} className="text-sm underline underline-offset-4">
                  Edit
                </Link>
                <TemplateRowActions firmId={firmId} id={t.id} isDefault={t.isDefault} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
