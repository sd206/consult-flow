import { z } from 'zod'
import { isIsoDate } from '@/lib/domain/dates'
import { parseMoney } from '@/lib/domain/money'
import { fail, type Result } from '@/lib/result'

const date = (msg: string) => z.string().refine(isIsoDate, msg)
const TWO_DP = /^\d+(\.\d{1,2})?$/

const canonical2dp = (v: string) => {
  const [w, f = ''] = v.split('.')
  return `${w}.${f.padEnd(2, '0')}`
}

/** 0-100 with up to two decimal places; returns the canonical string. */
const percent = (msg: string) =>
  z
    .string()
    .trim()
    .refine((v) => TWO_DP.test(v) && Number(v) <= 100, msg)
    .transform(canonical2dp)

// Column limits: quantity numeric(9,2), money numeric(12,2).
const MAX_QUANTITY = 9999999.99
const MAX_AMOUNT = 9999999999.99
const AMOUNT_TOO_LARGE = 'Amount is too large.'

/** parseMoney, but a well-formed amount above the column limit gets its own message. */
function parseBoundedMoney(v: string): Result<string> {
  const cleaned = v.trim().replace(/,/g, '')
  if (TWO_DP.test(cleaned) && Number(cleaned) > MAX_AMOUNT) return fail(AMOUNT_TOO_LARGE)
  return parseMoney(v)
}

const money = () =>
  z.string().transform((v, ctx) => {
    const r = parseBoundedMoney(v)
    if (!r.ok) {
      ctx.addIssue({ code: 'custom', message: r.error })
      return z.NEVER
    }
    return r.data
  })

const PERIOD_MSG = 'The period end must be on or after the period start.'

export const builderSchema = z
  .object({
    clientId: z.string().min(1, 'Choose a client.'),
    periodStart: date('Enter a valid start date.'),
    periodEnd: date('Enter a valid end date.'),
    templateId: z.string().min(1, 'Choose a template.'),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { path: ['periodEnd'], message: PERIOD_MSG })

export const periodSchema = z
  .object({
    periodStart: date('Enter a valid start date.'),
    periodEnd: date('Enter a valid end date.'),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { path: ['periodEnd'], message: PERIOD_MSG })

export const headerSchema = z
  .object({
    subject: z
      .string()
      .trim()
      .max(200, 'Keep the subject to 200 characters or fewer.')
      .transform((v) => (v === '' ? null : v)),
    issueDate: date('Enter a valid issue date.'),
    dueDate: date('Enter a valid due date.'),
    taxPercent: percent('Tax must be between 0 and 100 percent.'),
    templateId: z.string().min(1, 'Choose a template.'),
  })
  .refine((v) => v.dueDate >= v.issueDate, {
    path: ['dueDate'],
    message: 'The due date must be on or after the issue date.',
  })

const description = () =>
  z.string().trim().min(1, 'Enter a description.').max(500, 'Keep the description to 500 characters or fewer.')

export const lineDescriptionSchema = z.object({ description: description() })

export const manualLineSchema = z.object({
  description: description(),
  quantity: z
    .string()
    .trim()
    .refine((v) => TWO_DP.test(v) && Number(v) > 0, 'Enter a quantity above 0.')
    .refine((v) => !TWO_DP.test(v) || Number(v) <= MAX_QUANTITY, 'Quantity is too large.')
    .transform(canonical2dp),
  unitPrice: money(),
})

export const discountSchema = z
  .object({
    type: z.enum(['none', 'percent', 'amount']),
    value: z.string().trim(),
    label: z
      .string()
      .trim()
      .max(60, 'Keep the label to 60 characters or fewer.')
      .transform((v) => (v === '' ? null : v)),
  })
  .transform((v, ctx) => {
    if (v.type === 'none') return { type: v.type, value: '0.00', label: null }
    if (v.type === 'percent') {
      const p = percent('Enter a percentage between 0 and 100.').safeParse(v.value)
      if (!p.success) {
        ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter a percentage between 0 and 100.' })
        return z.NEVER
      }
      return { type: v.type, value: p.data, label: v.label }
    }
    const m = parseBoundedMoney(v.value)
    if (!m.ok) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: m.error })
      return z.NEVER
    }
    return { type: v.type, value: m.data, label: v.label }
  })
