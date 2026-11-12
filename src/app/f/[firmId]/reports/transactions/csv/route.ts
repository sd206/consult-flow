import { requireFirmRole } from '@/lib/auth/context'
import { todayIso } from '@/lib/domain/dates'
import { getTransactions, parseTxnParams } from '@/modules/reports/transactions'
import { buildTxnCsv } from '@/modules/reports/transactions-csv'

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

  const parsed = parseTxnParams(search, todayIso())
  if (!parsed.ok) return text(parsed.error, 400)
  const result = await getTransactions(db, firmId, parsed.data)
  if (!result.ok) return text(result.error, 500)

  const { filename, body } = buildTxnCsv(result.data.rows, result.data.totals, parsed.data)
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
