import { z } from 'zod'

const TEXT_MAX_MSG = 'Keep this to 500 characters or fewer.'
const text = () => z.string().trim().max(500, TEXT_MAX_MSG)

export type TemplateOptions = {
  accentColor: string
  showConsultant: boolean
  showProject: boolean
  showQuantity: boolean
  showRate: boolean
  showTaskNotes: boolean
  showDailyDetail: boolean
  paymentTermsText: string
  footerText: string
}

export const DEFAULT_TEMPLATE_OPTIONS: TemplateOptions = {
  accentColor: '#1F2937',
  showConsultant: true,
  showProject: true,
  showQuantity: true,
  showRate: true,
  showTaskNotes: true,
  showDailyDetail: false,
  paymentTermsText: '',
  footerText: '',
}

export const templateOptionsSchema = z.object({
  accentColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a colour like #1F2937.')
    .default(DEFAULT_TEMPLATE_OPTIONS.accentColor),
  showConsultant: z.boolean().default(DEFAULT_TEMPLATE_OPTIONS.showConsultant),
  showProject: z.boolean().default(DEFAULT_TEMPLATE_OPTIONS.showProject),
  showQuantity: z.boolean().default(DEFAULT_TEMPLATE_OPTIONS.showQuantity),
  showRate: z.boolean().default(DEFAULT_TEMPLATE_OPTIONS.showRate),
  showTaskNotes: z.boolean().default(DEFAULT_TEMPLATE_OPTIONS.showTaskNotes),
  showDailyDetail: z.boolean().default(DEFAULT_TEMPLATE_OPTIONS.showDailyDetail),
  paymentTermsText: text().default(DEFAULT_TEMPLATE_OPTIONS.paymentTermsText),
  footerText: text().default(DEFAULT_TEMPLATE_OPTIONS.footerText),
})

export const templateInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a template name.').max(60, 'Keep the name to 60 characters or fewer.'),
  baseLayout: z.enum(['classic', 'modern', 'compact']),
  options: templateOptionsSchema,
})

/** Tolerant reader for DB JSON: any invalid or missing key falls back to its default. */
export function parseTemplateOptions(json: unknown): TemplateOptions {
  const raw = json !== null && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {}
  const out: Record<string, unknown> = { ...DEFAULT_TEMPLATE_OPTIONS }
  for (const key of Object.keys(DEFAULT_TEMPLATE_OPTIONS) as (keyof TemplateOptions)[]) {
    if (!(key in raw)) continue
    const field = templateOptionsSchema.shape[key].safeParse(raw[key])
    if (field.success) out[key] = field.data
  }
  return out as TemplateOptions
}
