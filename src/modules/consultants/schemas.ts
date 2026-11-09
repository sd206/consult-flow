import { z } from 'zod'

const optionalId = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.uuid('Choose a valid vendor.').nullable())

const base = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(100, 'Name is too long.'),
  email: z.string().trim().pipe(z.email('Enter a valid email address.')),
  type: z.enum(['employee', 'independent', 'vendor']),
  vendorId: optionalId,
})

/** Only vendor contractors have a vendor; any submitted vendorId is dropped for other types. */
const forceVendor = <T extends { type: string; vendorId: string | null }>(v: T): T => ({
  ...v,
  vendorId: v.type === 'vendor' ? v.vendorId : null,
})

export const consultantUpdateSchema = base.transform(forceVendor)

export const consultantCreateSchema = base
  .extend({
    initialHourlyCost: z.string().trim(),
    initialCostFrom: z.string().trim(),
  })
  .transform(forceVendor)

export const costRateSchema = z.object({
  hourlyCost: z.string().trim().min(1, 'Enter an hourly cost.'),
  effectiveFrom: z.string().trim().min(1, 'Enter a start date.'),
})
