import { z } from 'zod'

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} is too long.`)

export const vendorSchema = z.object({
  name: z.string().trim().min(1, 'Enter a vendor name.').max(100, 'Vendor name is too long.'),
  contactName: optionalText(100, 'Contact name'),
  email: z
    .string()
    .trim()
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address.'),
  phone: optionalText(40, 'Phone number'),
  address: optionalText(500, 'Address'),
})

export type VendorFormInput = z.infer<typeof vendorSchema>
