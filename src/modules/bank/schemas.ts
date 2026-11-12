import { z } from 'zod'

const uuid = (message: string) =>
  z
    .string()
    .trim()
    .refine((v) => z.uuid().safeParse(v).success, message)

const optionalId = (message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || z.uuid().safeParse(v).success, message)
    .transform((v) => (v === '' ? null : v))

const notes = z
  .string()
  .trim()
  .max(1000, 'Keep notes to 1000 characters or fewer.')
  .transform((v) => (v === '' ? null : v))

export const accountSchema = z.object({
  name: z.string().trim().min(1, 'Enter an account name.').max(60, 'Keep the name to 60 characters or fewer.'),
  kind: z.enum(['bank', 'credit_card'], { message: 'Choose Bank or Credit card.' }),
  last4: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{4}$/.test(v), 'Enter the last 4 digits, or leave it blank.')
    .transform((v) => (v === '' ? null : v)),
})
export type AccountInput = z.infer<typeof accountSchema>

const column = z.number().int().min(0).max(99)

export const csvMappingSchema = z
  .object({
    dateColumn: column,
    dateFormat: z.enum(['YMD', 'MDY', 'DMY']),
    descriptionColumn: column,
    amount: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('signed'), column, flip: z.boolean() }),
      z.object({ mode: z.literal('inout'), inColumn: column, outColumn: column }),
    ]),
  })
  .refine((m) => {
    const cols =
      m.amount.mode === 'signed'
        ? [m.dateColumn, m.descriptionColumn, m.amount.column]
        : [m.dateColumn, m.descriptionColumn, m.amount.inColumn, m.amount.outColumn]
    return new Set(cols).size === cols.length
  }, 'Each column can only be used once.')

export const paymentConfirmSchema = z.object({
  invoiceId: uuid('Choose an invoice.'),
  notes,
})

export const expenseConfirmSchema = z.object({
  payee: z.string().trim().min(1, 'Enter who was paid.').max(200, 'Keep this to 200 characters or fewer.'),
  categoryId: uuid('Choose a category.'),
  clientId: optionalId('Choose a client from the list.'),
  projectId: optionalId('Choose a project from the list.'),
  notes,
})

export const otherIncomeConfirmSchema = z.object({
  source: z.string().trim().min(1, 'Enter who paid.').max(120, 'Keep this to 120 characters or fewer.'),
  categoryId: uuid('Choose a category.'),
  notes,
})
