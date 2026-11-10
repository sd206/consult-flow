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

## Timesheets

- Weeks start on Monday. Time can be entered for the current and past weeks only ("today" is UTC); future weeks are not allowed.
- Consultants enter and submit their own timesheet at `/f/{firmId}/timesheet`. Admins and Managers review submitted timesheets at `/f/{firmId}/timesheets`, and approve or reject them with a comment. They may approve their own. Managers can also enter time on someone's behalf.
- Rates are frozen on approval. An approved timesheet can be reopened while none of its hours are invoiced.
- To let an Admin or Manager log their own time, link their login to a consultant record: an Admin opens Consultants, opens the consultant, and chooses "Invite to log in" (this links an existing member or invites the email).

## Invoicing

- **Templates (Admin):** Settings → Invoice templates. Choose a Classic, Modern or Compact layout, an accent colour, which columns to show, payment terms and footer text, and whether to add an hours detail page. One template is the default; each firm starts with "Standard".
- **Building (Admin and Manager):** Invoices → New invoice. Pick the client, period and template. Approved, not-yet-invoiced hours are grouped into one line per consultant × project × rate, with task notes as the description. Untick consultants to leave them out. Add manual lines (description, quantity, unit price) for fees or rebilled costs. One optional discount (percentage or fixed amount) is taken off before tax; the tax percent defaults from firm settings.
- **Issuing:** assigns the next number from the firm's pattern (tokens `{YYYY}`, `{YY}`, `{MM}`, `{SEQ:n}`; the sequence never resets or rewinds), freezes the firm and client details on the invoice, locks the hours so they cannot be invoiced twice or reopened, and stores a PDF in Storage (amounts shown with the currency code). If the PDF fails the invoice stays issued; use "Regenerate PDF". If hours changed since the draft was built, issuing asks you to regenerate the lines.
- **Voiding:** an issued, unpaid invoice can be voided. Its hours return to the pool and its number is not reused. Drafts can be deleted.
- Consultants never see invoices or rates.

## Payments

- **Who:** Admins and Managers record, edit and delete payments, on the invoice page under "Payments". Consultants see nothing of this.
- **Recording:** a payment has an amount, a date (not in the future), a method (bank transfer, check, card, cash, other), an optional reference and notes. Payments can be recorded on issued and partly paid invoices. The amount can't be edited; delete the payment and record it again instead. Date, method, reference, notes and files can be edited.
- **Status changes automatically:** issued with no payments, partly paid while some balance remains, paid when the payments equal the total. Deleting a payment moves it back. A payment that would take the total paid above the invoice total is refused.
- **Files:** attach PDF, PNG, JPEG or HEIC files, up to 10 MB each and 5 per upload. Files are checked by their content, not just their name or type; a file that fails the check is skipped with a warning and the payment is still recorded.
- **Deleting** a payment deletes its files too. The deletion stays in the audit log.
- **Unpaid invoices** (Invoices, then Unpaid invoices): balance due per invoice, filterable by client, with ageing by days past the due date: not yet due, 1-30, 31-60, 61-90 and over 90 days. The dashboard shows the outstanding and overdue totals.
- **Voiding:** an invoice with payments can't be voided; delete its payments first.

## Hosted Supabase

### Platform owner

Sign-ups are disabled, so create the platform owner by hand: in the Supabase Dashboard go to Authentication → Users → Add user, enter the email and a password (at least 10 characters), and mark the email as confirmed. Then make that user a platform owner in the SQL editor:

```sql
update public.profiles set is_platform_owner = true where email = 'you@example.com';
```

The profile row is created automatically when the user is added.

### Email

- Hosted Supabase's built-in email service only delivers to members of the Supabase project's team, and at a very low rate. Configure custom SMTP (Dashboard → Authentication → Emails → SMTP Settings) before inviting real users.
- Invite, magic-link and password-recovery emails must link to `/auth/confirm` with a token hash, not the default links. Set the hosted templates to match `supabase/templates/invite.html`, `magic_link.html` and `recovery.html` (Dashboard → Authentication → Email Templates, or `npx supabase config push`, which pushes `supabase/config.toml` including the templates). With the default templates, invite links put the session in the URL fragment and sign-in fails with "That sign-in link is invalid or has expired."

### Auth settings

The hosted project must mirror the local `supabase/config.toml` auth settings:

- Sign-ups disabled (`enable_signup = false`); users are added only by invitation.
- Minimum password length 10 (`minimum_password_length = 10`).
- Site URL set to the deployed app URL (the email templates build their links from it), and the redirect URLs `<site URL>/auth/callback` and `<site URL>/auth/confirm` added to the allowed redirect list.

Also set `NEXT_PUBLIC_SITE_URL` to the deployed URL in the app's environment.
