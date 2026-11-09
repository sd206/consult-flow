import { requireFirmRole } from '@/lib/auth/context'

export default async function FirmDashboard({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params
  const { firmName } = await requireFirmRole(firmId, ['admin', 'manager', 'consultant'])
  return <h1 className="text-2xl font-semibold">{firmName} dashboard</h1>
}
