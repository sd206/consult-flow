import { LoginForm } from './login-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; signedOut?: string }>
}) {
  const { error, signedOut } = await searchParams
  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center p-6">
      <LoginForm
        initialError={error === 'link' ? 'That sign-in link is invalid or has expired.' : null}
        initialMessage={signedOut === '1' ? "You've signed out." : null}
      />
    </main>
  )
}
