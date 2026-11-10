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
- **Files:** attach PDF, PNG, JPEG or HEIC files, up to 10 MB each and 5 per upload. The payment is recorded first; files then go directly from the browser to storage (so request size limits on the host don't apply) and are checked by their content, not just their name or type, before being attached. A file that fails the check is removed and skipped with a warning; the payment stays recorded. Downloads use a short-lived storage link.
- **Deleting** a payment deletes its files too. The deletion stays in the audit log.
- **Unpaid invoices** (Invoices, then Unpaid invoices): balance due per invoice, filterable by client, with ageing by days past the due date: not yet due, 1-30, 31-60, 61-90 and over 90 days. The dashboard shows the outstanding and overdue totals.
- **Voiding:** an invoice with payments can't be voided; delete its payments first.

## Expenses

- **Who:** Admins and Managers record, edit and delete expenses at `/f/{firmId}/expenses`. Consultants see nothing of this.
- **Amount:** one amount per expense, tax included. Tax is not tracked separately. The date can't be in the future.
- **Client follows the project:** choosing a project sets the expense's client from it, and if a project's client later changes, its expenses move with it. An expense with no project can have a client chosen directly, or none.
- **Categories** (Expenses → Categories): each firm starts with Travel, Software, Office, Contractors, Professional fees and Other. Names are unique within a firm (ignoring case and surrounding spaces). A category can be retired, so it can't be chosen for new or re-categorised expenses while existing expenses keep it, and restored later. A category can only be deleted while no expense uses it.
- **Receipts:** optional, but expenses without one are flagged "No receipt" in the list, and the list can be filtered to those. Files follow the same rules as payment files: PDF, PNG, JPEG or HEIC, up to 10 MB each and 5 per upload, checked by their content. Downloads use a short-lived storage link. Deleting an expense deletes its receipts too.
- **Totals:** the list shows the number of expenses and their combined amount for the current filters (date range, category, client, project, no receipt only), not just the visible page.

## Reports

- **Who and where:** Admins and Managers open Reports → Profit & loss (`/f/{firmId}/reports/pnl`). Consultants cannot see reports.
- **Choose a view:** pick a date range (from and to, both included, at most 3 years apart) and group by month, quarter, client or project. Optionally filter to some clients or projects.
- **Columns:**
  - **Revenue from hours:** approved hours times the client rate frozen on each entry, counted on the date the work was done. Hours on timesheets that are not approved yet are not counted.
  - **Fees:** manual invoice lines (fees and rebilled costs) on issued, partly paid and paid invoices, counted on the invoice issue date. Voided and draft invoices are ignored.
  - **Discounts:** the discount taken off those invoices, counted on the issue date.
  - **Revenue:** revenue from hours plus fees minus discounts.
  - **Labour cost:** the same approved hours times the cost rate frozen on each entry.
  - **Gross profit:** revenue minus labour cost.
  - **Direct expenses:** expenses that have a client or a project, counted on the expense date.
  - **Overhead:** expenses with neither a client nor a project, counted on the expense date.
  - **Net profit:** gross profit minus direct expenses minus overhead.
  - **Margin %:** net profit as a percentage of revenue, blank when revenue is zero.
  - **Invoiced:** invoice subtotal minus discount, on the issue date. Tax is not included.
  - **Collected:** payments received, on the payment date, with the tax share removed in proportion to each invoice (a payment on an invoice that is 10% tax counts as the payment less that tax share). Voided invoices are ignored.
- **When things are counted:** hours are reported when the work was done, not when they are invoiced or paid. Fees, discounts and invoiced amounts follow the invoice issue date, and collected follows the payment date, so Invoiced and Collected can differ from Revenue in any one period.
- **Overhead by grouping:** month and quarter rows include overhead (every month in the range is shown, even empty ones). Client and project groupings do not spread overhead across clients; it appears in a single "Unallocated overhead" row instead. Every view ends with a Total row.
- **Filters drop overhead:** choosing any client or project filter removes overhead everywhere, including the Unallocated row, since overhead belongs to no client. A project filter also leaves out anything not tied to a project: fees, discounts, invoiced and collected amounts, and expenses recorded against a client without a project.
- **Project grouping:** rows are labelled "Client — Project". Fees, discounts, invoiced and collected amounts, and expenses that have a client but no project, appear in a "Client — no project" row for that client.
- **Range limit:** more than 3 years between from and to is refused with "Choose a range of 3 years or less."
- **CSV export:** the Export CSV button downloads the table as `pnl-{from}-to-{to}-by-{group}.csv`. It opens correctly in Excel, including accented characters. Amounts are plain numbers such as `1234.50`. Text starting with `=`, `+`, `-`, `@`, a tab or a line break gets a leading apostrophe, so a client named `=SUM(...)` cannot run as a spreadsheet formula.

## File storage

Payment and expense files are uploaded from the browser straight to storage under a holding name (`incoming-*`), then checked by the server, which moves the good ones into place and removes the rest. Users can't overwrite or delete stored files outside the app; the database policies only allow adding holding-name uploads. Abandoned uploads (older than 24 hours) are swept the next time that payment's or expense's folder is touched.

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
