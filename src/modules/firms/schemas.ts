import { z } from 'zod'

export const createFirmSchema = z.object({
  name: z.string().trim().min(1, 'Enter a firm name.').max(100, 'Firm name is too long.'),
  adminEmail: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
})

export type CreateFirmInput = z.infer<typeof createFirmSchema>
