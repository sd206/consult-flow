import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requireFirmRole } from '@/lib/auth/context'
import { isIsoDate } from '@/lib/domain/dates'
import { listClients } from '@/modules/clients/data'
import { listTemplates } from '@/modules/invoice-templates/data'
import { listCandidates, type Candidate } from '@/modules/invoices/data'
import { BuilderForm } from './builder-form'

const select = 'h-8 rounded-lg border bg-background px-2 text-sm'

/** First and last day of the previous calendar month (UTC). */
function previousMonth(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '')

export default async function NewInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { firmId } = await params
  const sp = await searchParams
  const { db } = await requireFirmRole(firmId, ['admin', 'manager'])
  const [clients, templates] = await Promise.all([listClients(db, firmId), listTemplates(db, firmId)])
  const defaults = previousMonth()
  const start = isIsoDate(one(sp.start)) ? one(sp.start) : defaults.start
  const end = isIsoDate(one(sp.end)) ? one(sp.end) : defaults.end
  const loadError = !clients.ok ? clients.error : !templates.ok ? templates.error : null
  const clientList = clients.ok ? clients.data : []
  const templateList = templates.ok ? templates.data : []
  const clientId = clientList.some((c) => c.id === one(sp.client)) ? one(sp.client) : ''
  const templateId = templateList.some((t) => t.id === one(sp.template))
    ? one(sp.template)
    : (templateList.find((t) => t.isDefault)?.id ?? templateList[0]?.id ?? '')

  let candidates: Candidate[] | null = null
  let candidateError: string | null = null
  if (clientId && end >= start) {
    const r = await listCandidates(db, firmId, clientId, start, end)
    if (r.ok) candidates = r.data
    else candidateError = r.error
  }

  return (
    <div className="max-w-3xl">
      <Link href={`/f/${firmId}/invoices`} className="text-sm underline underline-offset-4">
        Invoices
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">New invoice</h1>

      {loadError && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {loadError}
        </p>
      )}

      <form method="get" className="mt-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="inv-client">Client</Label>
          <select id="inv-client" name="client" defaultValue={clientId} required className={select}>
            <option value="" disabled>
              Choose a client
            </option>
            {clientList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="inv-start">Period start</Label>
          <Input id="inv-start" name="start" type="date" defaultValue={start} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="inv-end">Period end</Label>
          <Input id="inv-end" name="end" type="date" defaultValue={end} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="inv-template">Template</Label>
          <select id="inv-template" name="template" defaultValue={templateId} className={select}>
            {templateList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Find hours
        </Button>
      </form>

      {clientId && end < start && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          The period end must be on or after the period start.
        </p>
      )}
      {candidateError && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {candidateError}
        </p>
      )}
      {candidates && (
        <BuilderForm
          key={`${clientId}|${start}|${end}|${templateId}`}
          firmId={firmId}
          clientId={clientId}
          periodStart={start}
          periodEnd={end}
          templateId={templateId}
          candidates={candidates}
        />
      )}
    </div>
  )
}
