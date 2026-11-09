import { z } from 'zod'

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} is too long.`)

export const clientSchema = z.object({
  name: z.string().trim().min(1, 'Enter a client name.').max(100, 'Client name is too long.'),
  billingContactName: optionalText(100, 'Contact name'),
  billingEmail: z
    .string()
    .trim()
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address.'),
  billingPhone: optionalText(40, 'Phone number'),
  billingAddress: optionalText(500, 'Address'),
})
