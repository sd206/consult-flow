'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserDb } from '@/lib/supabase/browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function LoginForm({ initialError }: { initialError: string | null }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(initialError)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    const { error: err } = await createBrowserDb().auth.signInWithPassword({ email, password })
    setBusy(false)
    if (err) {
      console.error('signInWithPassword failed', err)
      setError('Email or password is incorrect.')
      return
    }
    router.push('/')
    router.refresh()
  }

  async function sendLink() {
    if (!email) {
      setError('Enter your email first.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    const { error: err } = await createBrowserDb().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    setBusy(false)
    if (err) {
      console.error('signInWithOtp failed', err)
      setError('We could not send the link. Please try again.')
      return
    }
    setMessage('Check your email for a sign-in link.')
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <h1>Sign in</h1>
        </CardTitle>
        <CardDescription>Consulting Ops</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={signIn} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            Sign in
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={sendLink}>
            Email me a link
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
