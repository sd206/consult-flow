'use client'

import { askConfirm } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { useRun } from '@/components/use-run'
import { setAccountActiveAction } from '@/modules/bank/actions'

export function AccountStatusButton({ firmId, accountId, active }: { firmId: string; accountId: string; active: boolean }) {
  const { pending, run, error } = useRun()
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={async () => {
          if (active && !(await askConfirm('Deactivate this account? You can no longer upload statements to it until you reactivate it.', { confirmLabel: 'Deactivate' }))) return
          run(() => setAccountActiveAction(firmId, accountId, !active))
        }}
      >
        {active ? 'Deactivate account' : 'Reactivate account'}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
