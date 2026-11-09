import { z } from 'zod'
import { validateInvoicePattern } from '@/lib/domain/invoice-pattern'

export const createFirmSchema = z.object({
  name: z.string().trim().min(1, 'Enter a firm name.').max(100, 'Firm name is too long.'),
  adminEmail: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
})

export type CreateFirmInput = z.infer<typeof createFirmSchema>

const CURRENCIES = new Set(Intl.supportedValuesOf('currency'))

export const firmSettingsSchema = z.object({
  name: z.string().trim().min(1, 'Enter a firm name.').max(100, 'Firm name is too long.'),
  address: z.string().trim().max(500, 'Address is too long.'),
  contactName: z.string().trim().max(100, 'Contact name is too long.'),
  contactEmail: z
    .string()
    .trim()
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address.'),
  contactPhone: z.string().trim().max(40, 'Phone number is too long.'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => CURRENCIES.has(v), 'Choose a valid currency.'),
  defaultTaxPercent: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Enter a tax rate from 0 to 100 with up to 2 decimals.')
    .refine((v) => Number(v) >= 0 && Number(v) <= 100, 'Tax rate must be between 0 and 100.'),
  defaultPaymentTermsDays: z.coerce
    .number({ error: 'Enter whole days from 0 to 365.' })
    .int('Enter whole days from 0 to 365.')
    .min(0, 'Enter whole days from 0 to 365.')
    .max(365, 'Enter whole days from 0 to 365.'),
  invoiceNumberPattern: z.string().superRefine((v, ctx) => {
    const r = validateInvoicePattern(v)
    if (!r.ok) ctx.addIssue({ code: 'custom', message: r.error })
  }),
})

export type FirmSettingsInput = z.infer<typeof firmSettingsSchema>
