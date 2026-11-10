'use server'

import { revalidatePath } from 'next/cache'
import { requireFirmRole } from '@/lib/auth/context'
import { fieldErrorsOf, type FormResult, str } from '@/lib/form'
import { createCategory, deleteCategory, renameCategory, setCategoryActive } from './data'
import { categoryFormSchema } from './schemas'

const MANAGERS = ['admin', 'manager'] as const

function revalidate(firmId: string) {
  revalidatePath(`/f/${firmId}/expenses`)
  revalidatePath(`/f/${firmId}/expenses/categories`)
}

export async function createCategoryAction(firmId: string, formData: FormData): Promise<FormResult<{ id: string }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = categoryFormSchema.safeParse({ name: str(formData, 'name') })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const result = await createCategory(db, firmId, parsed.data.name)
  if (result.ok) revalidate(firmId)
  return result
}

export async function renameCategoryAction(firmId: string, id: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = categoryFormSchema.safeParse({ name: str(formData, 'name') })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const result = await renameCategory(db, firmId, id, parsed.data.name)
  if (result.ok) revalidate(firmId)
  return result
}

export async function setCategoryActiveAction(firmId: string, id: string, active: boolean): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const result = await setCategoryActive(db, firmId, id, active)
  if (result.ok) revalidate(firmId)
  return result
}

export async function deleteCategoryAction(firmId: string, id: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const result = await deleteCategory(db, firmId, id)
  if (result.ok) revalidate(firmId)
  return result
}
