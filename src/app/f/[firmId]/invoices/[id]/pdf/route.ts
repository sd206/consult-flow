import { requireFirmRole } from '@/lib/auth/context'
import { getInvoice } from '@/modules/invoices/data'
import { renderInvoicePdf } from '@/modules/invoices/pdf/render'
import { loadInvoiceDocument, readStoredPdf } from '@/modules/invoices/pdf/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}

function pdf(bytes: Uint8Array, name: string): Response {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '-')
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safe}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

export async function GET(_req: Request, { params }: { params: Promise<{ firmId: string; id: string }> }) {
  const { firmId, id } = await params
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])

  const inv = await getInvoice(db, firmId, id)
  if (!inv.ok) return text('Invoice not found.', 404)
  const invoice = inv.data

  if (invoice.status === 'draft') {
    const doc = await loadInvoiceDocument(db, firmId, id)
    if (!doc.ok) return text(doc.error, 500)
    try {
      return pdf(await renderInvoicePdf(doc.data), 'draft-invoice')
    } catch (e) {
      console.error('draft PDF preview failed', e)
      return text("The PDF couldn't be created.", 500)
    }
  }

  if (!invoice.pdfPath) return text('No PDF yet. Use Regenerate PDF.', 404)
  const stored = await readStoredPdf(db, invoice.pdfPath)
  if (!stored.ok) return text('No PDF yet. Use Regenerate PDF.', 404)
  return pdf(stored.data, invoice.number ?? 'invoice')
}
