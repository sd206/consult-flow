'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import type { InvoiceDeposit } from '@/modules/bank/data'
import { BankDeposits } from '../../invoices/[id]/bank-deposits'
import { RecordForm } from '../../invoices/[id]/payments-section'

/**
 * Bank deposits plus the manual form for one invoice. After a payment is
 * recorded we return to where the user came from; if some files couldn't be
 * attached we stay and show the warning with a link back instead.
 */
export function RecordPaymentPanel({
  firmId,
  invoiceId,
  invoiceLabel,
  currency,
  balanceDue,
  deposits,
  returnHref,
  closedReason,
}: {
  firmId: string
  invoiceId: string
  invoiceLabel: string
  currency: string
  balanceDue: string
  deposits: InvoiceDeposit[] | null
  returnHref: string
  /** Set when the invoice can no longer take payments (e.g. just paid in full). */
  closedReason: string | null
}) {
  const router = useRouter()
  const warningRef = useRef<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const done = () => {
    if (!warningRef.current) router.push(returnHref)
  }

  // Rendered in the same place whether or not the invoice is still open, so a
  // warning about files survives the refresh after a payment that completes it.
  if (closedReason) {
    return (
      <>
        <p className="mt-4 text-sm">This invoice can&apos;t take more payments: {closedReason}.</p>
        {warning && (
          <p role="status" className="mt-3 text-sm">
            {warning}{' '}
            <Link href={returnHref} className="underline underline-offset-4">
              Continue
            </Link>
          </p>
        )}
      </>
    )
  }

  return (
    <>
      {deposits && (
        <BankDeposits
          firmId={firmId}
          invoiceId={invoiceId}
          invoiceLabel={invoiceLabel}
          currency={currency}
          deposits={deposits}
          onRecorded={done}
        />
      )}
      <section aria-labelledby="manual-heading" className="mt-6 rounded-xl border bg-card p-4">
        <h2 id="manual-heading" className="text-base font-semibold">
          Record manually
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">For checks, cash or anything not in an imported statement.</p>
        <RecordForm
          firmId={firmId}
          invoiceId={invoiceId}
          balanceDue={balanceDue}
          onWarning={(w) => {
            warningRef.current = w
            setWarning(w)
          }}
          onRecorded={done}
        />
      </section>
      {warning && (
        <p role="status" className="mt-3 text-sm">
          {warning}{' '}
          <Link href={returnHref} className="underline underline-offset-4">
            Continue
          </Link>
        </p>
      )}
    </>
  )
}
