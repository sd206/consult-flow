# Consulting Ops

A multi-tenant web app for consulting firms to run their operations: each firm manages its own members, vendors, consultants (with hourly cost rates), clients, projects and consultant assignments (with client rates), and sees margin per hour. A platform owner creates firms and their first Admin. Built with Next.js 15 (App Router) and Supabase (Postgres, Auth, Storage) with row-level security for tenant isolation.

## Prerequisites

- Node.js 22 or newer, and npm
- Docker Desktop, running (the local Supabase stack uses it)

## Setup

```bash
npm i
npx supabase start
```

Then create `.env.local` (for the app) and `.env.test.local` (for tests) from `.env.example`, using the values printed by `npx supabase status`:

```
NEXT_PUBLIC_SUPABASE_URL=<API URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Never commit these files or the keys.

Seed the database and start the app:

```bash
npm run db:reset   # applies migrations and seeds the local platform owner
npm run dev        # http://localhost:3000
```

`db:reset` creates the platform owner `owner@local.test` / `owner-password-123`. This account is for local development only; it is not created on hosted projects.

### Local ports

The local Supabase ports are shifted +100 from the defaults (API 54421, DB 54422, Studio 54423, Mailpit 54424) because another local Supabase project already uses the 543xx range. They are set in `supabase/config.toml`. If you have no conflict you may revert them, but then use the URLs that `npx supabase status` prints.

## Tests

```bash
npm run test:unit   # fast, no services needed
npm run test:int    # database/RLS tests; needs local Supabase running
npm run test:e2e    # Playwright; needs local Supabase running
```

`test:e2e` builds the app and starts it on port 3000 (reusing a server already running there when not in CI), and runs the browser tests serially. Also run `npm run lint` and `npm run typecheck`.

## Hosted Supabase

Make a hosted user a platform owner in the SQL editor:

```sql
update public.profiles set is_platform_owner = true where email = 'you@example.com';
```

The user must have signed up/in at least once so a profile row exists.

### Hosted Supabase settings

The hosted project must mirror the local `supabase/config.toml` auth settings:

- Sign-ups disabled (`enable_signup = false`); users are added only by invitation.
- Minimum password length 10 (`minimum_password_length = 10`).
- Site URL set to the deployed app URL, and the redirect URL `<site URL>/auth/callback` added to the allowed redirect list.

Also set `NEXT_PUBLIC_SITE_URL` to the deployed URL in the app's environment.
