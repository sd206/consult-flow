import type { SupabaseClient } from '@supabase/supabase-js'
import { findOrInviteUser } from '@/lib/auth/invite'
import { mapDbError } from '@/lib/db-errors'
import { validateInvoicePattern } from '@/lib/domain/invoice-pattern'
import { fail, ok, type Result } from '@/lib/result'
import type { FirmSettingsInput } from './schemas'

/**
 * Platform-owner operation: `admin` is the service-role client and the caller has already
 * verified platform-owner status. The firm and its first admin membership are created in one
 * SQL function (single transaction), so a failure never leaves an orphan firm.
 */
export async function createFirmWithAdmin(
  admin: SupabaseClient,
  input: { name: string; adminEmail: string },
  redirectTo: string,
): Promise<Result<{ firmId: string }>> {
  const name = input.name.trim()
  if (!name) return fail('Enter a firm name.')

  const user = await findOrInviteUser(admin, input.adminEmail, redirectTo)
  if (!user.ok) return user

  const { data, error } = await admin.rpc('create_firm_with_admin', {
    p_name: name,
    p_admin: user.data.userId,
  })
  if (error || typeof data !== 'string') return fail(mapDbError(error))
  return ok({ firmId: data })
}

const DENIED = "You don't have permission to do that."
const BUCKET = 'firm-files'
const LOGO_ERROR = 'Logo must be a PNG or JPEG under 2 MB.'
const MAX_LOGO_BYTES = 2 * 1024 * 1024

export type Firm = {
  id: string
  name: string
  address: string
  contactName: string
  contactEmail: string
  contactPhone: string
  currency: string
  defaultTaxPercent: string
  defaultPaymentTermsDays: number
  invoiceNumberPattern: string
  logoPath: string | null
  logoUrl: string | null
}

export async function getFirm(db: SupabaseClient, firmId: string): Promise<Result<Firm>> {
  const { data, error } = await db
    .from('firms')
    .select(
      'id, name, address, contact_name, contact_email, contact_phone, currency, default_tax_percent::text, default_payment_terms_days, invoice_number_pattern, logo_path',
    )
    .eq('id', firmId)
    .maybeSingle()
  if (error) return fail(mapDbError(error))
  if (!data) return fail('Firm not found.')

  let logoUrl: string | null = null
  const logoPath = (data.logo_path as string | null) ?? null
  if (logoPath) {
    const signed = await db.storage.from(BUCKET).createSignedUrl(logoPath, 3600)
    if (signed.error) console.error(signed.error)
    else logoUrl = signed.data.signedUrl
  }

  return ok({
    id: data.id as string,
    name: data.name as string,
    address: (data.address as string | null) ?? '',
    contactName: (data.contact_name as string | null) ?? '',
    contactEmail: (data.contact_email as string | null) ?? '',
    contactPhone: (data.contact_phone as string | null) ?? '',
    currency: data.currency as string,
    defaultTaxPercent: data.default_tax_percent as string,
    defaultPaymentTermsDays: data.default_payment_terms_days as number,
    invoiceNumberPattern: data.invoice_number_pattern as string,
    logoPath,
    logoUrl,
  })
}

export async function updateFirmSettings(
  db: SupabaseClient,
  firmId: string,
  input: FirmSettingsInput,
): Promise<Result<void>> {
  const pattern = validateInvoicePattern(input.invoiceNumberPattern)
  if (!pattern.ok) return pattern

  const blankToNull = (v: string): string | null => (v.trim() === '' ? null : v.trim())
  const { data, error } = await db
    .from('firms')
    .update({
      name: input.name.trim(),
      address: blankToNull(input.address),
      contact_name: blankToNull(input.contactName),
      contact_email: blankToNull(input.contactEmail),
      contact_phone: blankToNull(input.contactPhone),
      currency: input.currency,
      default_tax_percent: Number(input.defaultTaxPercent),
      default_payment_terms_days: input.defaultPaymentTermsDays,
      invoice_number_pattern: input.invoiceNumberPattern,
    })
    .eq('id', firmId)
    .select('id')
  if (error) return fail(mapDbError(error))
  // RLS filters rows the caller may not update; zero rows means no permission.
  if (!data || data.length === 0) return fail(DENIED)
  return ok(undefined)
}

export type LogoFile = { name: string; type: string; size: number; bytes: ArrayBuffer }

const LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b)
}

/** Magic-byte check: the bytes must really be the declared PNG or JPEG. */
function contentMatchesType(type: string, buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer)
  if (type === 'image/png') return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (type === 'image/jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff])
  return false
}

export async function uploadFirmLogo(
  db: SupabaseClient,
  firmId: string,
  file: LogoFile,
): Promise<Result<{ logoPath: string }>> {
  const ext = LOGO_TYPES[file.type]
  // Size is checked before the bytes are inspected.
  if (!ext || file.size > MAX_LOGO_BYTES || file.bytes.byteLength > MAX_LOGO_BYTES) {
    return fail(LOGO_ERROR)
  }
  if (!contentMatchesType(file.type, file.bytes)) return fail(LOGO_ERROR)

  const prefix = `firms/${firmId}/logo/`
  const current = await db.from('firms').select('logo_path').eq('id', firmId).maybeSingle()
  if (current.error) return fail(mapDbError(current.error))
  const previous = (current.data?.logo_path as string | null | undefined) ?? null

  const path = `${prefix}${crypto.randomUUID()}.${ext}`
  const up = await db.storage.from(BUCKET).upload(path, file.bytes, {
    contentType: file.type,
    upsert: false,
  })
  if (up.error) return fail(mapDbError({ message: up.error.message }))

  const { data, error } = await db.from('firms').update({ logo_path: path }).eq('id', firmId).select('id')
  if (error || !data || data.length === 0) {
    const rm = await db.storage.from(BUCKET).remove([path])
    if (rm.error) console.error(rm.error)
    return fail(error ? mapDbError(error) : DENIED)
  }

  if (previous && previous !== path && previous.startsWith(prefix)) {
    const rm = await db.storage.from(BUCKET).remove([previous])
    if (rm.error) console.error(rm.error)
  }
  return ok({ logoPath: path })
}
