'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireFirmRole } from '@/lib/auth/context'
import { isIsoDate, todayIso } from '@/lib/domain/dates'
import { parseMoney } from '@/lib/domain/money'
import { fieldErrorsOf, type FormResult, str } from '@/lib/form'
import { createOtherIncome, deleteOtherIncome, updateOtherIncome } from './data'

const MANAGERS = ['admin', 'manager'] as const

const incomeSchema = z.object({
  receivedOn: z
    .string()
    .refine(isIsoDate, 'Enter a valid date.')
    .refine((v) => v <= todayIso(), "The date can't be in the future."),
  categoryId: z
    .string()
    .trim()
    .refine((v) => z.uuid().safeParse(v).success, 'Choose a category.'),
  source: z.string().trim().min(1, 'Enter who paid.').max(120, 'Keep this to 120 characters or fewer.'),
  amount: z.string().transform((v, ctx) => {
    const r = parseMoney(v)
    if (!r.ok || Number(r.data) <= 0) {
      ctx.addIssue({ code: 'custom', message: r.ok ? 'Enter an amount above 0.' : r.error })
      return z.NEVER
    }
    return r.data
  }),
  notes: z
    .string()
    .trim()
    .max(1000, 'Keep notes to 1000 characters or fewer.')
    .transform((v) => (v === '' ? null : v)),
})

function parse(fd: FormData) {
  return incomeSchema.safeParse({
    receivedOn: str(fd, 'receivedOn'),
    categoryId: str(fd, 'categoryId'),
    source: str(fd, 'source'),
    amount: str(fd, 'amount'),
    notes: str(fd, 'notes'),
  })
}

function revalidate(firmId: string) {
  revalidatePath(`/f/${firmId}/other-income`)
  revalidatePath(`/f/${firmId}/reports/transactions`)
}

export async function createOtherIncomeAction(firmId: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = parse(formData)
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const r = await createOtherIncome(db, firmId, parsed.data)
  if (r.ok) revalidate(firmId)
  return r
}

export async function updateOtherIncomeAction(firmId: string, id: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = parse(formData)
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const r = await updateOtherIncome(db, firmId, id, parsed.data)
  if (r.ok) revalidate(firmId)
  return r
}

export async function deleteOtherIncomeAction(firmId: string, id: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const r = await deleteOtherIncome(db, firmId, id)
  if (r.ok) {
    revalidate(firmId)
    revalidatePath(`/f/${firmId}/bank`, 'layout')
  }
  return r
}
