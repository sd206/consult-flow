import { z } from 'zod'

export const firmRoleSchema = z.enum(['admin', 'manager', 'consultant'])

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  role: firmRoleSchema,
})

export const changeRoleSchema = z.object({
  userId: z.uuid(),
  role: firmRoleSchema,
})

export const removeMemberSchema = z.object({ userId: z.uuid() })
