'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRun } from '@/components/use-run'
import { createAccountAction, updateAccountAction } from '@/modules/bank/actions'

const select = 'h-8 rounded-lg border bg-card px-2 text-sm'

export function AccountForm({
  firmId,
  account,
}: {
  firmId: string
  account?: { id: string; name: string; kind: 'bank' | 'credit_card'; last4: string | null }
}) {
  const { pending, run, errors, error } = useRun()
  return (
    <form
      aria-label={account ? 'Edit account' : 'New account'}
      className="mt-4 grid max-w-md gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        run(() => (account ? updateAccountAction(firmId, account.id, fd) : createAccountAction(firmId, fd)))
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="acct-name">Account name</Label>
        <Input id="acct-name" name="name" defaultValue={account?.name} placeholder="Main checking" aria-invalid={!!errors.name} />
        {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="acct-kind">Type</Label>
        <select id="acct-kind" name="kind" defaultValue={account?.kind ?? 'bank'} className={select}>
          <option value="bank">Bank</option>
          <option value="credit_card">Credit card</option>
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="acct-last4">Last 4 digits (optional)</Label>
        <Input
          id="acct-last4"
          name="last4"
          inputMode="numeric"
          maxLength={4}
          defaultValue={account?.last4 ?? ''}
          className="w-24"
          aria-invalid={!!errors.last4}
        />
        {errors.last4 && <p className="text-xs text-destructive">{errors.last4}</p>}
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {account ? 'Save account' : 'Add account'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
