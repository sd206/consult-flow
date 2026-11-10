import { requireFirmRole } from '@/lib/auth/context'
import { attachmentDownloadUrl } from '@/modules/payments/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = 'private, no-store'

/**
 * Checks the user and firm, then redirects to a short-lived signed storage link, so the file
 * never passes through this function (no response-size limit, no buffering).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ firmId: string; id: string }> }) {
  const { firmId, id } = await params
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])

  const link = await attachmentDownloadUrl(db, firmId, id)
  if (!link.ok) {
    return new Response('File not found.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': NO_STORE },
    })
  }
  return new Response(null, { status: 302, headers: { Location: link.data.url, 'Cache-Control': NO_STORE } })
}
