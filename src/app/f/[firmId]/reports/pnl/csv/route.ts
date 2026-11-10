import { requireFirmRole } from '@/lib/auth/context'
import { todayIso } from '@/lib/domain/dates'
import { getPnl, parsePnlParams } from '@/modules/reports/pnl'
import { buildPnlCsv } from '@/modules/reports/pnl-csv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}

export async function GET(req: Request, { params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])

  const search: Record<string, string[]> = {}
  for (const [k, v] of new URL(req.url).searchParams) (search[k] ??= []).push(v)

  const parsed = parsePnlParams(search, todayIso())
  if (!parsed.ok) return text(parsed.error, 400)
  const rows = await getPnl(db, firmId, parsed.data)
  if (!rows.ok) return text(rows.error, 500)

  const { filename, body } = buildPnlCsv(rows.data, parsed.data)
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
