'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserDb } from '@/lib/supabase/browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const MIN_LENGTH = 10

export function SetPasswordForm({ change = false }: { change?: boolean }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`)
      return
    }
    setBusy(true)
    setError(null)
    const { error: err } = await createBrowserDb().auth.updateUser({
      password,
      data: { password_set: true },
    })
    setBusy(false)
    if (err) {
      console.error('updateUser failed', err)
      setError(
        /different from the old/i.test(err.message)
          ? 'Choose a password different from your current one.'
          : 'We could not set your password. Please try again.',
      )
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <h1>{change ? 'Change your password' : 'Set your password'}</h1>
        </CardTitle>
        <CardDescription>Choose a password of at least {MIN_LENGTH} characters.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            Save password
          </Button>
          {change && (
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
