import { z } from 'zod'
import { isIsoDate } from '@/lib/domain/dates'

const optionalDate = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || isIsoDate(v), `Enter a valid ${label}.`)

const requiredDate = (label: string) =>
  z.string().trim().min(1, `Enter a ${label}.`).refine(isIsoDate, `Enter a valid ${label}.`)

export const projectSchema = z.object({
  clientId: z.string().trim().pipe(z.uuid('Choose a client.')),
  name: z.string().trim().min(1, 'Enter a project name.').max(100, 'Project name is too long.'),
  code: z.string().trim().max(40, 'Project code is too long.'),
  status: z.enum(['active', 'on_hold', 'closed']),
  startDate: optionalDate('start date'),
  endDate: optionalDate('end date'),
})

export const assignmentSchema = z.object({
  consultantId: z.string().trim().pipe(z.uuid('Choose a consultant.')),
  clientRate: z.string().trim().min(1, 'Enter a client rate.'),
  effectiveFrom: requiredDate('start date'),
  effectiveTo: optionalDate('end date'),
})

export const changeRateSchema = z.object({
  clientRate: z.string().trim().min(1, 'Enter a client rate.'),
  effectiveFrom: requiredDate('start date'),
})

export const endAssignmentSchema = z.object({
  effectiveTo: requiredDate('end date'),
})
