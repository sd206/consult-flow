import Link from 'next/link'
import { requireFirmRole } from '@/lib/auth/context'
import { getFirm } from '@/modules/firms/data'
import { LogoForm, SettingsForm } from './settings-forms'

export default async function SettingsPage({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params
  const { db } = await requireFirmRole(firmId, ['admin'])
  const firm = await getFirm(db, firmId)

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-2 text-sm">
        <Link href={`/f/${firmId}/settings/templates`} className="underline underline-offset-4">
          Invoice templates
        </Link>
      </p>
      {!firm.ok ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {firm.error}
        </p>
      ) : (
        <>
          <h2 className="mt-6 text-lg font-medium">Logo</h2>
          <LogoForm firmId={firmId} logoUrl={firm.data.logoUrl} />
          <h2 className="mt-8 text-lg font-medium">Firm details</h2>
          <SettingsForm firmId={firmId} firm={firm.data} currencies={Intl.supportedValuesOf('currency')} />
        </>
      )}
    </div>
  )
}
