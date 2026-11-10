'use client'

import { Button } from '@/components/ui/button'
import { regeneratePdfAction, voidInvoiceAction } from '@/modules/invoices/actions'
import { useRun } from '@/components/use-run'

export function IssuedActions({
  firmId,
  invoiceId,
  status,
  hasPdf,
}: {
  firmId: string
  invoiceId: string
  status: string
  hasPdf: boolean
}) {
  const { pending, run, error } = useRun()
  const pdfHref = `/f/${firmId}/invoices/${invoiceId}/pdf`

  const isVoid = status === 'void'
  const canRegenerate = ['issued', 'partly_paid', 'paid'].includes(status)

  return (
    <div className="mt-6">
      {isVoid && <p className="mb-3 text-sm font-medium">This invoice is void.</p>}
      <div className="flex flex-wrap items-center gap-3">
        {hasPdf && (
          <a href={pdfHref} className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm font-medium">
            {isVoid ? 'Download original PDF' : 'Download PDF'}
          </a>
        )}
        {!hasPdf && canRegenerate && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => regeneratePdfAction(firmId, invoiceId))}>
            Regenerate PDF
          </Button>
        )}
        {status === 'issued' && (
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              if (
                window.confirm("Void this invoice? Its hours become available to invoice again. The number won't be reused.")
              ) {
                run(() => voidInvoiceAction(firmId, invoiceId))
              }
            }}
          >
            Void invoice
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
