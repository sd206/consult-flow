import { z } from 'zod'
import { isIsoDate, todayIso } from '@/lib/domain/dates'
import { parseMoney } from '@/lib/domain/money'

const METHODS = ['bank_transfer', 'check', 'card', 'cash', 'other'] as const
const MAX_AMOUNT = 9999999999.99

const amount = () =>
  z.string().transform((v, ctx) => {
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

const paidOn = () =>
  z
    .string()
    .refine(isIsoDate, 'Enter a valid payment date.')
    .refine((v) => v <= todayIso(), "The payment date can't be in the future.")

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this to ${max} characters or fewer.`)
    .transform((v) => (v === '' ? null : v))

const details = {
  paidOn: paidOn(),
  method: z.enum(METHODS, { message: 'Choose a payment method.' }),
  reference: optionalText(120),
  notes: optionalText(1000),
}

export const paymentInputSchema = z.object({ amount: amount(), ...details })
export const paymentDetailsSchema = z.object(details)
