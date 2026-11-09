import { fail, ok, type Result } from '@/lib/result'

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_FILES_PER_UPLOAD = 5

export type AttachmentKind = 'pdf' | 'png' | 'jpeg' | 'heic'
export type AttachmentInfo = { kind: AttachmentKind; ext: 'pdf' | 'png' | 'jpg' | 'heic'; mime: string }

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end))
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b)
}

function detect(bytes: Uint8Array): AttachmentInfo | null {
  if (ascii(bytes, 0, 5) === '%PDF-') return { kind: 'pdf', ext: 'pdf', mime: 'application/pdf' }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'png', ext: 'png', mime: 'image/png' }
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'jpeg', ext: 'jpg', mime: 'image/jpeg' }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp' && HEIC_BRANDS.includes(ascii(bytes, 8, 12))) {
    return { kind: 'heic', ext: 'heic', mime: 'image/heic' }
  }
  return null
}

/** Checks size and file signature. The declared type and extension are ignored. */
export function validateAttachment(file: {
  name: string
  type: string
  size: number
  bytes: Uint8Array
}): Result<AttachmentInfo> {
  // The buffer is what gets stored, so its real length counts, not just the declared size.
  if (file.size <= 0 || file.bytes.length === 0) return fail('That file is empty.')
  if (Math.max(file.size, file.bytes.length) > MAX_ATTACHMENT_BYTES) {
    return fail('Each file must be 10 MB or smaller.')
  }
  const info = detect(file.bytes)
  if (!info) return fail('Only PDF, PNG, JPEG or HEIC files can be attached.')
  return ok(info)
}

/** A safe name for display only: no path parts or control characters. */
export function displayFileName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, '')
  const base = cleaned.split(/[/\\]/).pop() ?? ''
  return base.trim().slice(0, 120) || 'file'
}
