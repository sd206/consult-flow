import { z } from 'zod'
import { isIsoDate, todayIso } from '@/lib/domain/dates'
import { parseMoney } from '@/lib/domain/money'

const MAX_AMOUNT = 9999999999.99

const amount = z.string().transform((v, ctx) => {
  const r = parseMoney(v)
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: r.error })
    return z.NEVER
  }
  if (Number(r.data) <= 0) {
    ctx.addIssue({ code: 'custom', message: 'Enter an amount above 0.' })
    return z.NEVER
  }
  if (Number(r.data) > MAX_AMOUNT) {
    ctx.addIssue({ code: 'custom', message: 'Amount is too large.' })
    return z.NEVER
  }
  return r.data
})

const optionalId = (message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || z.uuid().safeParse(v).success, message)
    .transform((v) => (v === '' ? null : v))

export const expenseInputSchema = z.object({
  spentOn: z
    .string()
    .refine(isIsoDate, 'Enter a valid date.')
    .refine((v) => v <= todayIso(), "The expense date can't be in the future."),
  categoryId: z
    .string()
    .trim()
    .refine((v) => z.uuid().safeParse(v).success, 'Choose a category.'),
  payee: z.string().trim().min(1, 'Enter who was paid.').max(200, 'Keep this to 200 characters or fewer.'),
  amount,
  clientId: optionalId('Choose a valid client.'),
  projectId: optionalId('Choose a valid project.'),
  notes: z
    .string()
    .trim()
    .max(1000, 'Keep this to 1000 characters or fewer.')
    .transform((v) => (v === '' ? null : v)),
})
