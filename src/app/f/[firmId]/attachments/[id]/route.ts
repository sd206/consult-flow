import { requireFirmRole } from '@/lib/auth/context'
import { displayFileName } from '@/lib/domain/attachments'
import { readAttachment } from '@/modules/payments/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}

/** Header values must be ASCII, so non-ASCII names go in an RFC 5987 filename* as well. */
function contentDisposition(name: string): string {
  const clean = displayFileName(name).replace(/["\\]/g, '')
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_')
  const base = `inline; filename="${ascii}"`
  if (ascii === clean) return base
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${base}; filename*=UTF-8''${encoded}`
}

export async function GET(_req: Request, { params }: { params: Promise<{ firmId: string; id: string }> }) {
  const { firmId, id } = await params
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])

  const file = await readAttachment(db, firmId, id)
  if (!file.ok) return text('File not found.', 404)
  return new Response(Buffer.from(file.data.bytes), {
    headers: {
      'Content-Type': file.data.mimeType,
      'Content-Disposition': contentDisposition(file.data.fileName),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
