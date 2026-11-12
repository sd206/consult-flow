'use client'

import Link from 'next/link'
import { useState } from 'react'
import { askConfirm } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRun } from '@/components/use-run'
import { formatMoney } from '@/lib/domain/money'
import { recordFromDepositAction } from '@/modules/bank/actions'
import type { InvoiceDeposit } from '@/modules/bank/data'

const th = 'py-2 pr-4 font-medium'
const td = 'py-2 pr-4 align-top'

function day(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** Imported deposits that can be recorded as a payment on this invoice in one click. */
export function BankDeposits({
  firmId,
  invoiceId,
  invoiceLabel,
  currency,
  deposits,
  onRecorded,
}: {
  firmId: string
  invoiceId: string
  invoiceLabel: string
  currency: string
  deposits: InvoiceDeposit[]
  onRecorded?: () => void
}) {
  const { pending, run, error } = useRun()
  const [notes, setNotes] = useState('')
  const m = (v: string) => formatMoney(v, currency)

  return (
    <section aria-labelledby="deposits-heading" className="mt-6 rounded-xl border bg-card p-4">
      <h3 id="deposits-heading" className="text-base font-semibold">
        Deposits from your bank
      </h3>
      {deposits.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          No imported deposits from the last 90 days fit this invoice.{' '}
          <Link href={`/f/${firmId}/bank`} className="text-primary underline-offset-4 hover:underline">
            Bank accounts
          </Link>
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Imported deposits waiting for review, up to the balance due. Recording one uses its amount and date and marks
            the bank line as done.
          </p>
          <div className="mt-3 grid max-w-md gap-1.5 text-sm">
            <label htmlFor="deposit-notes">Notes for the payment (optional)</label>
            <Input id="deposit-notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th scope="col" className={th}>Date</th>
                  <th scope="col" className={th}>Account</th>
                  <th scope="col" className={th}>Description</th>
                  <th scope="col" className={`${th} text-right`}>Amount</th>
                  <th scope="col" className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((d) => (
                  <tr key={d.lineId} className="border-b">
                    <td className={`${td} whitespace-nowrap`}>{d.postedOn}</td>
                    <td className={td}>{d.accountName}</td>
                    <th scope="row" className={`${td} font-normal`}>
                      {d.description}
                      {d.exactMatch && (
                        <span className="ml-2 rounded border border-primary px-1 text-xs text-primary">Exact balance</span>
                      )}
                    </th>
                    <td className={`${td} whitespace-nowrap text-right`}>{m(d.amount)}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <Button
                        type="button"
                        size="sm"
                        disabled={pending}
                        onClick={async () => {
                          const ok = await askConfirm(
                            `Record ${m(d.amount)} from ${d.accountName} on ${day(d.postedOn)} as a payment on ${invoiceLabel}?`,
                            { confirmLabel: 'Record payment' },
                          )
                          if (ok) run(() => recordFromDepositAction(firmId, invoiceId, d.lineId, notes), () => {
                            setNotes('')
                            onRecorded?.()
                          })
                        }}
                      >
                        Record this payment<span className="sr-only"> of {m(d.amount)} on {d.postedOn}</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm">
            <Link href={`/f/${firmId}/bank`} className="text-primary underline-offset-4 hover:underline">
              Review all bank lines
            </Link>
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
