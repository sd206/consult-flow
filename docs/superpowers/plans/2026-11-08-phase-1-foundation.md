# Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working multi-tenant app where the platform owner creates firms, firm Admins manage users, roles and firm settings, and Managers maintain vendors, consultants, clients, projects, cost rates and client rates — with every firm's data isolated by Postgres row-level security.

**Architecture:** Next.js App Router app; each module exposes plain data functions that take a `SupabaseClient` (testable against local Supabase), wrapped by thin `'use server'` actions. All tenancy and role rules live in Postgres (RLS, constraints, triggers); the service-role client is used only for platform-owner and invite operations, after an explicit permission check.

**Tech Stack:** Next.js 15 (App Router, TypeScript strict), React 19, Supabase (Postgres 15+, Auth, Storage) via `@supabase/supabase-js` 2 and `@supabase/ssr`, Supabase CLI (local stack in Docker), Zod 3, Tailwind CSS 4 + shadcn/ui, Vitest 3, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-consulting-ops-design.md` (sections 3, 3.1, 3.2, 4.1, 4.5, 6, 7, 9 phase 1)

## Global Constraints

- Node.js 22 LTS; npm. Prerequisites on the dev machine: Docker Desktop running, Supabase CLI installed (`npx supabase` is acceptable).
- TypeScript `strict: true`; no `any` in module code.
- Every business table: `id uuid primary key default gen_random_uuid()`, `firm_id uuid not null references firms(id)`, `created_at timestamptz not null default now()`, `created_by uuid default auth.uid()`, `updated_at timestamptz not null default now()` (maintained by a shared `set_updated_at()` trigger).
- RLS enabled on every table in `public`. No table is readable by `anon`.
- Cross-table references inside a firm use **composite foreign keys** `(firm_id, x_id) references x(firm_id, id)` so a row can never point into another firm. Each referenced table gets `unique (firm_id, id)`.
- Money columns `numeric(12,2)`, must be `>= 0`; never JS `number` arithmetic on money — money travels as strings between DB and UI.
- Roles: `admin | manager | consultant` (Postgres enum `firm_role`). Consultant types: `employee | independent | vendor` (enum `consultant_type`). Project status: `active | on_hold | closed` (enum `project_status`).
- Default `firms.invoice_number_pattern` = `'INV-{YYYY}-{SEQ:4}'`, `invoice_next_seq` = 1, `currency` = `'USD'`, `default_tax_percent` = 0, `default_payment_terms_days` = 30.
- Storage: one private bucket `firm-files`; object paths `firms/{firm_id}/...`. Logos at `firms/{firm_id}/logo/{random}.{ext}`. Allowed logo types PNG, JPEG, SVG; max 2 MB. (Attachment limits — PDF/PNG/JPEG/HEIC, 10 MB — arrive in phases 4–5.)
- The service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is imported only from `src/lib/supabase/admin.ts`, which starts with `import 'server-only'`.
- User-facing errors are short plain sentences produced by `mapDbError`; raw Postgres/Supabase messages are logged with `console.error` and never shown.
- Module data functions return `Result<T>` = `{ ok: true; data: T } | { ok: false; error: string }` and never throw for expected failures.

## Review Focus

1. **Inviting an email that already has an account** (e.g. a contractor who works for two firms) → adds a membership to this firm, does not error or send a new signup. Test in Task 9.
2. **Inviting someone already in this firm** → plain message "That person is already a member of this firm.", no duplicate row. Test in Task 9.
3. **Opening another firm's URL** (`/f/{otherFirmId}/...`) while signed in to a different firm → 404, never data. Tests in Tasks 2 and 8.
4. **Overlapping client-rate periods** for the same consultant and project (including an open-ended one) → rejected with "This consultant already has a rate for this project in that date range." Test in Task 5.
5. **Bad logo upload** (12 MB file, or a `.exe` renamed `.png` with wrong MIME) → rejected with a plain message, nothing stored. Test in Task 10.

---

## File Structure

```
consulting-app/
  package.json  tsconfig.json  next.config.ts  vitest.config.ts  playwright.config.ts
  .env.example  .gitignore  components.json
  supabase/
    config.toml
    seed.sql                                  # local-only: platform owner user
    migrations/
      20261108000001_core_tenancy.sql         # enums, profiles, firms, firm_members, helpers, RLS, last-admin guard
      20261108000002_audit.sql                # audit_log + audit_row() trigger fn
      20261108000003_people.sql               # vendors, consultants, consultant_cost_rates
      20261108000004_clients_projects.sql     # clients, projects, project_assignments, my_assignments()
      20261108000005_storage.sql              # firm-files bucket + policies
  src/
    middleware.ts
    lib/
      result.ts                               # Result<T>, ok(), fail()
      db-types.ts                             # aliases over generated supabase/types.ts
      db-errors.ts                            # mapDbError()
      domain/money.ts  domain/rates.ts  domain/invoice-pattern.ts   (+ *.test.ts beside each)
      supabase/server.ts  supabase/browser.ts  supabase/admin.ts  supabase/middleware.ts
      auth/context.ts                         # requireUser(), requireFirmRole()
      auth/invite.ts                          # findOrInviteUser()
    modules/
      firms/        schemas.ts  data.ts  actions.ts
      members/      schemas.ts  data.ts  actions.ts
      vendors/      schemas.ts  data.ts  actions.ts
      consultants/  schemas.ts  data.ts  actions.ts
      clients/      schemas.ts  data.ts  actions.ts
      projects/     schemas.ts  data.ts  actions.ts   # projects + assignments
    app/
      layout.tsx  page.tsx                    # / → firm picker or redirect
      login/page.tsx  auth/callback/route.ts  auth/set-password/page.tsx
      platform/firms/page.tsx
      f/[firmId]/layout.tsx                   # nav filtered by role; 404 if not a member
      f/[firmId]/page.tsx                     # dashboard (counts)
      f/[firmId]/settings/page.tsx
      f/[firmId]/users/page.tsx
      f/[firmId]/vendors/page.tsx
      f/[firmId]/consultants/page.tsx  f/[firmId]/consultants/[id]/page.tsx
      f/[firmId]/clients/page.tsx
      f/[firmId]/projects/page.tsx  f/[firmId]/projects/[id]/page.tsx
      f/[firmId]/my-projects/page.tsx
    components/ui/                            # shadcn components as added
  tests/
    integration/helpers.ts
    integration/*.test.ts                     # run against local Supabase
    e2e/foundation.spec.ts
```

---

### Task 1: Project scaffold and tooling

**Files:**
- Create: everything at repo root listed above, `supabase/config.toml` (via `supabase init`), `src/lib/result.ts`, `src/lib/result.test.ts`, `tests/integration/helpers.ts` (stub exporting nothing yet)

**Interfaces:**
- Produces: `src/lib/result.ts` — `type Result<T>`, `ok<T>(data: T): Result<T>`, `fail(error: string): Result<never>`
- Produces npm scripts: `dev`, `build`, `lint`, `typecheck` (`tsc --noEmit`), `test:unit`, `test:int`, `test:e2e`, `db:reset` (`supabase db reset`), `db:types` (`supabase gen types typescript --local > src/lib/supabase/types.ts`)
- Produces `vitest.config.ts` with two projects: `unit` (`src/**/*.test.ts`, node env) and `integration` (`tests/integration/**/*.test.ts`, `fileParallelism: false`, 30 s timeout, loads `.env.test.local`)

- [ ] **Step 1:** `npx create-next-app@15 . --ts --app --src-dir --tailwind --eslint --import-alias "@/*" --use-npm` (directory already has `docs/`; keep it). Then `npx shadcn@latest init` (defaults, neutral colour).
- [ ] **Step 2:** `npm i @supabase/supabase-js @supabase/ssr zod server-only` and `npm i -D vitest @vitest/coverage-v8 @playwright/test dotenv supabase`. `npx playwright install chromium`.
- [ ] **Step 3:** `npx supabase init`; in `config.toml` set `[auth] site_url = "http://localhost:3000"`, `additional_redirect_urls = ["http://localhost:3000/auth/callback"]`, `[auth.email] enable_confirmations = false`.
- [ ] **Step 4:** Write `.env.example` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`. `.gitignore` includes `.env*.local`, `supabase/.temp`.
- [ ] **Step 5: Write failing test** `src/lib/result.test.ts`: `ok(5)` equals `{ ok: true, data: 5 }`; `fail('x')` equals `{ ok: false, error: 'x' }`.
- [ ] **Step 6:** Run `npm run test:unit` → FAIL (module missing). Implement `result.ts`. Run → PASS.
- [ ] **Step 7:** `npx supabase start`; copy printed URL/keys into `.env.local` and `.env.test.local`. Run `npm run build` and `npm run typecheck` → both succeed.
- [ ] **Step 8: Commit** `git add -A && git commit -m "chore: scaffold Next.js + Supabase + test tooling"`

---

### Task 2: Core tenancy schema and RLS

**Files:**
- Create: `supabase/migrations/20261108000001_core_tenancy.sql`, `supabase/seed.sql`
- Modify: `tests/integration/helpers.ts`
- Test: `tests/integration/tenancy.test.ts`

**Interfaces:**
- Produces tables: `profiles(user_id uuid pk references auth.users on delete cascade, email text not null, display_name text, is_platform_owner boolean not null default false)`; `firms` (columns from spec 4.1 + Global Constraints defaults, `logo_path text`); `firm_members(firm_id, user_id references profiles(user_id), role firm_role)` with constraint name `firm_members_firm_user_key` on `(firm_id, user_id)`.
- Produces SQL functions (all `security definer`, `set search_path = ''`, `stable`):
  - `public.is_member(p_firm uuid) returns boolean`
  - `public.has_role(p_firm uuid, p_roles public.firm_role[]) returns boolean`
  - `public.is_platform_owner() returns boolean`
- Produces trigger `handle_new_user` on `auth.users` insert → inserts `profiles(user_id, email)`.
- Produces trigger `guard_last_admin` on `firm_members` before update/delete: if the change leaves the firm with zero admins, `raise exception 'LAST_ADMIN' using errcode = 'P0001'`.
- Produces `set_updated_at()` trigger function used by all later tables.
- Produces `public.platform_list_firms() returns table (id uuid, name text, created_at timestamptz, admin_emails text[])` — `security definer`; returns rows only when `is_platform_owner()`, otherwise empty. This is the platform owner's only window onto firms (no business data).
- Produces `src/lib/db-types.ts` re-exporting aliases from the generated `src/lib/supabase/types.ts`: `Database`, `FirmRole`, `ConsultantType`, `ProjectStatus` (the last two are added to the alias file in Tasks 4 and 5 once the enums exist).
- Produces test helpers in `tests/integration/helpers.ts`:
  - `adminDb(): SupabaseClient` (service role)
  - `type TestUser = { id: string; email: string; db: SupabaseClient }`
  - `newUser(label: string): Promise<TestUser>` — creates confirmed user with password and `user_metadata: { password_set: true }` via `auth.admin.createUser`, signs in with anon client
  - `newFirm(name?: string): Promise<{ firmId: string; admin: TestUser; manager: TestUser; consultant: TestUser }>` — inserts firm + three memberships with the service role

RLS policies:
| Table | select | insert | update | delete |
|---|---|---|---|---|
| profiles | own row, or user shares a firm with caller | none (trigger only) | own row, only `display_name` (column grant) | none |
| firms | `is_member(id)` only | none (service role) | `has_role(id, '{admin}')` | none |
| firm_members | `is_member(firm_id)` | none (service role) | `has_role(firm_id,'{admin}')`, only `role` column | `has_role(firm_id,'{admin}')` and `user_id <> auth.uid()` |

- [ ] **Step 1: Write failing tests** in `tenancy.test.ts`:
  - `member reads own firm, not another`: firm A admin selects `firms` → 1 row with A's id; select where `id = B` → 0 rows.
  - `consultant cannot update firm settings`: update `firms.name` as consultant → 0 rows affected; name unchanged (check via `adminDb`).
  - `admin updates firm name`: succeeds.
  - `nobody inserts firm_members from the client`: admin insert → error.
  - `admin changes a role`: manager → consultant succeeds.
  - `last admin cannot be demoted`: admin updates own role to manager → error message contains `LAST_ADMIN`; with a second admin added, it succeeds.
  - `admin cannot delete self`: delete own membership → 0 rows.
  - `profile created on signup`: `newUser` → `profiles` row exists with matching email, `is_platform_owner = false`.
  - `platform owner sees firm list only`: owner `rpc('platform_list_firms')` → includes A and B; owner select on `firms` → 0 rows; a firm admin calling `platform_list_firms` → 0 rows.
  - `anon reads nothing`: anon client select on `firms`, `firm_members`, `profiles` → 0 rows.
- [ ] **Step 2:** Run `npm run test:int -- tenancy` → FAIL (tables missing).
- [ ] **Step 3:** Write the migration per the Interfaces block and table above. Write `seed.sql` creating local user `owner@local.test` / password `owner-password-123` with `is_platform_owner = true` (local only; document in README later).
- [ ] **Step 4:** `npm run db:reset && npm run db:types`; run `npm run test:int -- tenancy` → PASS.
- [ ] **Step 5: Commit** `feat(db): core tenancy tables, role helpers, RLS, last-admin guard`

---

### Task 3: Audit log

**Files:**
- Create: `supabase/migrations/20261108000002_audit.sql`
- Test: `tests/integration/audit.test.ts`

**Interfaces:**
- Produces table `audit_log(id, firm_id, actor_id uuid, entity_type text, entity_id uuid, action text check in ('insert','update','delete'), before jsonb, after jsonb, at timestamptz default now())`. RLS: select `has_role(firm_id,'{admin}')`; no insert/update/delete policies (writes only via trigger).
- Produces trigger function `public.audit_row()` (`security definer`) usable as `after insert or update or delete ... for each row execute function public.audit_row()`; reads `firm_id` and `id` from `NEW`/`OLD`, `actor_id = auth.uid()`.
- Attached in this task to: `firm_members`. Later tasks attach it to `consultant_cost_rates` and `project_assignments`.

- [ ] **Step 1: Write failing tests:** after admin changes a member's role, `audit_log` (read as admin) has one `update` row with `before.role = 'manager'`, `after.role = 'consultant'`, `actor_id = admin.id`; manager selecting `audit_log` → 0 rows; admin `insert` into `audit_log` → error.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Write migration. **Step 4:** `db:reset`, run → PASS.
- [ ] **Step 5: Commit** `feat(db): audit log trigger`

---

### Task 4: Vendors, consultants, cost rates (schema)

**Files:**
- Create: `supabase/migrations/20261108000003_people.sql`
- Test: `tests/integration/people-db.test.ts`

**Interfaces:**
- Produces tables per spec 4.1 with these named constraints:
  - `vendors`: `unique (firm_id, id)`, `vendors_firm_name_key unique (firm_id, lower(name))` (as unique index)
  - `consultants`: `consultants_vendor_required_chk check ((type = 'vendor') = (vendor_id is not null))`; FK `consultants_vendor_fk (firm_id, vendor_id) references vendors(firm_id, id) on delete restrict`; `consultants_firm_email_key` unique index on `(firm_id, lower(email))`; `user_id references profiles(user_id) on delete set null`; `unique (firm_id, id)`
  - `consultant_cost_rates`: FK `(firm_id, consultant_id) references consultants(firm_id, id) on delete cascade`; `hourly_cost numeric(12,2) not null check (hourly_cost >= 0)`; `consultant_cost_rates_consultant_from_key unique (consultant_id, effective_from)`; audit trigger attached
- RLS: all three tables — select/insert/update/delete for `has_role(firm_id,'{admin,manager}')`. Additionally `consultants` select for the consultant's own row (`user_id = auth.uid()`). Consultants get no access to `vendors` or `consultant_cost_rates`.

- [ ] **Step 1: Write failing tests:**
  - manager creates vendor, vendor consultant, and cost rate `150.00` from `2026-01-01` → success.
  - consultant type `vendor` with null `vendor_id` → error code `23514`, constraint `consultants_vendor_required_chk`.
  - consultant pointing at firm B's vendor id → error `23503` (composite FK).
  - deleting a vendor that has consultants → error `23503`.
  - duplicate cost rate same `effective_from` → `23505`.
  - consultant user sees own `consultants` row only and 0 rows from `consultant_cost_rates` and `vendors`.
  - firm B manager sees 0 rows of firm A's three tables.
  - cost-rate insert writes an `audit_log` row.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Write migration. **Step 4:** `db:reset && db:types`, run → PASS.
- [ ] **Step 5: Commit** `feat(db): vendors, consultants, cost rates`

---

### Task 5: Clients, projects, assignments (schema)

**Files:**
- Create: `supabase/migrations/20261108000004_clients_projects.sql`
- Test: `tests/integration/clients-projects-db.test.ts`

**Interfaces:**
- Produces tables per spec 4.1 with named constraints:
  - `clients`: `unique (firm_id, id)`, `clients_firm_name_key` unique index `(firm_id, lower(name))`
  - `projects`: FK `projects_client_fk (firm_id, client_id) references clients(firm_id, id) on delete restrict`; `projects_dates_chk check (end_date is null or start_date is null or end_date >= start_date)`; `projects_firm_code_key` unique index `(firm_id, lower(code))` where code is not null; `unique (firm_id, id)`
  - `project_assignments`: FKs `(firm_id, project_id)` → projects, `(firm_id, consultant_id)` → consultants (both `on delete restrict`); `client_rate numeric(12,2) not null check (client_rate >= 0)`; `project_assignments_dates_chk check (effective_to is null or effective_to >= effective_from)`; `project_assignments_no_overlap exclude using gist (project_id with =, consultant_id with =, daterange(effective_from, effective_to, '[]') with &&)` (requires `create extension if not exists btree_gist`); audit trigger attached
- RLS: all three — full access for `has_role(firm_id,'{admin,manager}')`; nothing for consultants.
- Produces `public.my_assignments(p_firm uuid) returns table (assignment_id uuid, project_id uuid, project_name text, project_code text, client_name text, effective_from date, effective_to date)` — `security definer`, `set search_path = ''`, returns rows where the consultant's `user_id = auth.uid()` and `is_member(p_firm)`; **no rate columns**.

- [ ] **Step 1: Write failing tests:**
  - manager creates client, project, assignment rate `200.00` from `2026-01-01` open-ended → success.
  - **Review Focus 4:** second assignment same consultant+project from `2026-06-01` → error `23P01`; after setting the first's `effective_to = '2026-05-31'`, the insert succeeds; a third starting `2026-05-31` → `23P01`.
  - `effective_to` before `effective_from` → `23514`.
  - deleting a client with projects → `23503`.
  - consultant user: select on `projects`/`clients`/`project_assignments` → 0 rows; `rpc('my_assignments', { p_firm })` → their assignments with names and no `client_rate` key; another consultant's assignments not included.
  - firm B user calling `my_assignments(firmA)` → 0 rows.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Write migration. **Step 4:** `db:reset && db:types`, run → PASS.
- [ ] **Step 5: Commit** `feat(db): clients, projects, dated client-rate assignments`

---

### Task 6: Storage bucket and policies

**Files:**
- Create: `supabase/migrations/20261108000005_storage.sql`
- Test: `tests/integration/storage.test.ts`

**Interfaces:**
- Produces private bucket `firm-files` (`public = false`, `file_size_limit = 10485760`).
- Policies on `storage.objects` where `bucket_id = 'firm-files'`, with `fid = ((storage.foldername(name))[2])::uuid` and `(storage.foldername(name))[1] = 'firms'`:
  - select: `is_member(fid)`
  - insert/update/delete under `firms/{fid}/logo/`: `has_role(fid,'{admin}')`
  - insert/update/delete elsewhere under `firms/{fid}/`: `has_role(fid,'{admin,manager}')` (used by phases 4–5)

- [ ] **Step 1: Write failing tests:** admin uploads `firms/A/logo/x.png` → ok; manager uploading to the logo path → error; consultant of A downloads it → ok; user of firm B downloads it → error; admin of B uploading to `firms/A/logo/y.png` → error; malformed path `other/x.png` → error.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Write migration. **Step 4:** `db:reset`, run → PASS.
- [ ] **Step 5: Commit** `feat(db): firm-files storage bucket and policies`

---

### Task 7: Pure domain helpers and DB error mapping

**Files:**
- Create: `src/lib/domain/money.ts`, `src/lib/domain/rates.ts`, `src/lib/domain/invoice-pattern.ts`, `src/lib/db-errors.ts`, and a `*.test.ts` beside each

**Interfaces:**
- `money.ts`: `parseMoney(input: string): Result<string>` — trims, strips `,`, accepts `^\d{1,10}(\.\d{1,2})?$`, returns canonical 2-dp string; `formatMoney(amount: string, currency: string, locale?: string): string` via `Intl.NumberFormat`.
- `rates.ts`: `type DatedRate = { rate: string; effectiveFrom: string; effectiveTo?: string | null }` (ISO dates); `rateOn<T extends DatedRate>(rates: T[], date: string): T | null` — latest `effectiveFrom <= date` whose `effectiveTo` is null or `>= date`.
- `invoice-pattern.ts`: `validateInvoicePattern(pattern: string): Result<string>` — the spec's `{PREFIX}` is stored as literal text typed into the pattern (e.g. `SRS-`), not as a token; the only tokens are exactly `{YYYY}`, `{YY}`, `{MM}`, `{SEQ:n}` with `1 <= n <= 8`; must contain exactly one `{SEQ:n}`; literal characters limited to `[A-Za-z0-9-_/.]`; length 1–40. (Formatting is phase 3.)
- `db-errors.ts`: `mapDbError(err: { code?: string; message?: string; details?: string } | null): string`. Mapping (match on constraint name in `message`/`details`, else code):

| Match | Message |
|---|---|
| `firm_members_firm_user_key` | That person is already a member of this firm. |
| `LAST_ADMIN` | A firm needs at least one Admin. |
| `consultants_vendor_required_chk` | Vendor contractors must be linked to a vendor, and other types must not be. |
| `consultants_vendor_fk` | This vendor still has consultants. Reassign or remove them first. |
| `consultants_firm_email_key` | A consultant with that email already exists. |
| `consultant_cost_rates_consultant_from_key` | A cost rate already starts on that date. |
| `vendors_firm_name_key` / `clients_firm_name_key` | That name is already in use. |
| `projects_firm_code_key` | That project code is already in use. |
| `projects_client_fk` | This client still has projects. |
| `project_assignments_no_overlap` | This consultant already has a rate for this project in that date range. |
| `project_assignments_dates_chk` / `projects_dates_chk` | The end date must be on or after the start date. |
| code `42501` or RLS violation | You don't have permission to do that. |
| anything else | Something went wrong. Please try again. |

- [ ] **Step 1: Write failing tests:**
  - `parseMoney`: `'1,250.5'` → `ok('1250.50')`; `'0'` → `ok('0.00')`; `'-5'`, `'1.234'`, `'abc'`, `''` → `ok:false`.
  - `rateOn`: rates `[{rate:'100', effectiveFrom:'2026-01-01'}, {rate:'120', effectiveFrom:'2026-03-01'}]` → on `'2026-02-28'` gives `'100'`, on `'2026-03-01'` gives `'120'`, on `'2025-12-31'` gives `null`; with `effectiveTo:'2026-01-31'` on the first and no second, `'2026-02-01'` → `null`.
  - `validateInvoicePattern`: `'INV-{YYYY}-{SEQ:4}'` ok; `'SRS/{YY}{MM}/{SEQ:3}'` ok; `'INV-{YYYY}'` fail (no SEQ); `'{SEQ:4}-{SEQ:2}'` fail; `'{SEQ:9}'` fail; `'INV {SEQ:4}'` fail (space); `'{FOO}-{SEQ:4}'` fail.
  - `mapDbError`: one case per table row above, plus unknown → generic.
- [ ] **Step 2:** Run `npm run test:unit` → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: money, dated-rate, invoice-pattern helpers and DB error mapping`

---

### Task 8: Supabase clients, auth flow, firm context

**Files:**
- Create: `src/lib/supabase/{server,browser,admin,middleware}.ts`, `src/middleware.ts`, `src/lib/auth/context.ts`, `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`, `src/app/auth/set-password/page.tsx`, `src/app/page.tsx`, `src/app/f/[firmId]/layout.tsx`, `src/app/f/[firmId]/page.tsx`
- Test: `tests/e2e/auth.spec.ts`

**Interfaces:**
- `server.ts`: `createServerDb(): Promise<SupabaseClient<Database>>` (cookie-based, `@supabase/ssr`)
- `browser.ts`: `createBrowserDb(): SupabaseClient<Database>`
- `admin.ts`: `createAdminDb(): SupabaseClient<Database>` (service role; `server-only`)
- `middleware.ts`: refreshes the session; unauthenticated requests to anything except `/login` and `/auth/*` redirect to `/login`.
- `context.ts`:
  - `requireUser(): Promise<{ userId: string; email: string; isPlatformOwner: boolean; db: SupabaseClient<Database> }>` — redirects to `/login` if none
  - `requireFirmRole(firmId: string, roles: FirmRole[]): Promise<{ userId: string; firmId: string; role: FirmRole; firmName: string; db: SupabaseClient<Database> }>` — calls `notFound()` if the user is not a member (Review Focus 3) and `notFound()` if role not in `roles`
- Behaviour: `/login` offers email+password and "email me a link". `/auth/callback` exchanges the code; if the user has no password yet (`user_metadata.password_set !== true`) redirect to `/auth/set-password`, else `/`. `/auth/set-password` calls `auth.updateUser({ password, data: { password_set: true } })` (min 10 characters) then redirects to `/`. `/` lists the user's firms (name, role); exactly one → redirect to `/f/{id}`; platform owner also sees a "Platform" link. `f/[firmId]/layout.tsx` calls `requireFirmRole(firmId, ['admin','manager','consultant'])` and renders nav filtered by role (Consultant sees only Dashboard and My projects).

- [ ] **Step 1: Write failing e2e tests** (`auth.spec.ts`, using `newFirm()` from the integration helpers via a Playwright fixture): unauthenticated `/` → lands on `/login`; consultant logs in with password → lands on `/f/{firmA}`, nav shows "My projects" and not "Clients"; same consultant visits `/f/{firmB}` → 404 page; visits `/f/{firmA}/clients` → 404.
- [ ] **Step 2:** `npm run test:e2e -- auth` → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** `feat: auth flow, session middleware, firm-scoped layout`

---

### Task 9: Platform firm creation and member management

**Files:**
- Create: `src/lib/auth/invite.ts`, `src/modules/firms/{schemas,data,actions}.ts`, `src/modules/members/{schemas,data,actions}.ts`, `src/app/platform/firms/page.tsx`, `src/app/f/[firmId]/users/page.tsx`
- Test: `tests/integration/members.test.ts`

**Interfaces:**
- `invite.ts`: `findOrInviteUser(admin: SupabaseClient, email: string, redirectTo: string): Promise<Result<{ userId: string; invited: boolean }>>` — looks up `profiles` by `lower(email)` with the service role; if found returns `invited:false`; else `admin.auth.admin.inviteUserByEmail(email, { redirectTo })` and returns the new id.
- `firms/data.ts`: `createFirmWithAdmin(admin: SupabaseClient, input: { name: string; adminEmail: string }, redirectTo: string): Promise<Result<{ firmId: string }>>` — inserts firm, `findOrInviteUser`, inserts admin membership; on membership failure deletes the firm.
- `firms/actions.ts`: `createFirmAction(formData: FormData): Promise<Result<{ firmId: string }>>` — `requireUser()`, rejects unless `isPlatformOwner`, validates with Zod (`name` 1–100 chars, email), then calls the data fn with `createAdminDb()`.
- `members/data.ts`:
  - `listMembers(db, firmId): Promise<Result<{ userId: string; email: string; displayName: string | null; role: FirmRole }[]>>`
  - `inviteMember(db, admin, firmId, input: { email: string; role: FirmRole }, redirectTo): Promise<Result<{ userId: string; invited: boolean }>>` — first verifies `db.rpc('has_role', { p_firm: firmId, p_roles: ['admin'] })` is true (else `fail("You don't have permission to do that.")`); then `findOrInviteUser`; inserts `firm_members` via `admin`; if role is `consultant` and a `consultants` row in this firm has the same email with null `user_id`, sets its `user_id`.
  - `changeMemberRole(db, firmId, userId, role): Promise<Result<void>>`
  - `removeMember(db, firmId, userId): Promise<Result<void>>`
- `/platform/firms`: platform owner only (else 404); lists firms via `rpc('platform_list_firms')`; form: firm name + first Admin email.
- `/f/[firmId]/users`: Admin only; member table with role select and remove button; invite form (email, role).

- [ ] **Step 1: Write failing tests** (`members.test.ts`, calling data functions with test clients):
  - platform owner `createFirmWithAdmin` with new email → firm exists, membership role `admin`, `invited: true`.
  - **Review Focus 1:** `inviteMember` of an email that is already a user in firm B → `ok`, `invited: false`, membership created in firm A, firm B membership untouched.
  - **Review Focus 2:** inviting the same email to firm A again → `fail('That person is already a member of this firm.')`, still one row.
  - manager calling `inviteMember` → `fail("You don't have permission to do that.")`, no row.
  - inviting role `consultant` with a matching unlinked consultant record → that record's `user_id` is set.
  - `changeMemberRole` demoting the only admin → `fail('A firm needs at least one Admin.')`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement data fns, actions, and pages. **Step 4:** Run → PASS; manually load both pages in `npm run dev`.
- [ ] **Step 5: Commit** `feat: platform firm creation and firm member management`

---

### Task 10: Firm settings and logo

**Files:**
- Modify: `src/modules/firms/{schemas,data,actions}.ts`
- Create: `src/app/f/[firmId]/settings/page.tsx`
- Test: `tests/integration/firm-settings.test.ts`

**Interfaces:**
- `firms/schemas.ts`: `firmSettingsSchema` — `name` 1–100; `address` ≤ 500; `contactName`, `contactEmail` (email or empty), `contactPhone` ≤ 40; `currency` one of an ISO 4217 list (`Intl.supportedValuesOf('currency')`); `defaultTaxPercent` string `0`–`100`, ≤ 3 dp; `defaultPaymentTermsDays` int 0–365; `invoiceNumberPattern` refined with `validateInvoicePattern`.
- `firms/data.ts`:
  - `getFirm(db, firmId): Promise<Result<Firm>>` (+ `logoUrl` as a 1-hour signed URL when `logo_path` set)
  - `updateFirmSettings(db, firmId, input: FirmSettingsInput): Promise<Result<void>>`
  - `uploadFirmLogo(db, firmId, file: { name: string; type: string; size: number; bytes: ArrayBuffer }): Promise<Result<{ logoPath: string }>>` — rejects type not in `image/png|image/jpeg|image/svg+xml` or size > 2 MB **and** checks magic bytes (PNG `89 50 4E 47`, JPEG `FF D8 FF`, SVG text starting with `<svg` or `<?xml`) before uploading to `firms/{firmId}/logo/{uuid}.{ext}`; updates `firms.logo_path`; removes the previous logo object.
- Page: Admin only; form for all settings fields with inline field errors; logo preview + upload.

- [ ] **Step 1: Write failing tests:**
  - admin updates settings with pattern `SRS-{YYYY}-{SEQ:4}`, currency `GBP`, tax `20` → persisted.
  - pattern `INV-{YYYY}` → `ok:false` with the pattern error; nothing persisted.
  - manager `updateFirmSettings` → `fail("You don't have permission to do that.")` (RLS updates 0 rows → treat 0 rows as permission failure).
  - **Review Focus 5:** 12 MB PNG → `fail('Logo must be a PNG, JPEG or SVG under 2 MB.')`; bytes `4D 5A ...` with `type: 'image/png'` → same failure; no object stored in `firms/{id}/logo/`.
  - valid PNG upload → `logo_path` set; second upload replaces it and the first object is gone.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: firm settings and logo upload`

---

### Task 11: Vendors and consultants (with cost rates)

**Files:**
- Create: `src/modules/vendors/*`, `src/modules/consultants/*`, `src/app/f/[firmId]/vendors/page.tsx`, `src/app/f/[firmId]/consultants/page.tsx`, `src/app/f/[firmId]/consultants/[id]/page.tsx`
- Test: `tests/integration/vendors-consultants.test.ts`

**Interfaces:**
- `vendors/data.ts`: `listVendors(db, firmId)`, `createVendor(db, firmId, input: VendorInput): Promise<Result<{ id: string }>>`, `updateVendor(db, firmId, id, input)`, `deleteVendor(db, firmId, id)`. `VendorInput = { name; contactName?; email?; phone?; address? }`.
- `consultants/data.ts`:
  - `listConsultants(db, firmId, opts?: { includeInactive?: boolean }): Promise<Result<ConsultantRow[]>>` where `ConsultantRow` includes `vendorName: string | null`, `currentCost: string | null` (via `rateOn` for today), `hasLogin: boolean`
  - `getConsultant(db, firmId, id): Promise<Result<ConsultantDetail>>` (includes `costRates: { id; hourlyCost: string; effectiveFrom: string }[]` sorted desc)
  - `createConsultant(db, firmId, input: ConsultantInput): Promise<Result<{ id: string }>>`; `updateConsultant(db, firmId, id, input)`; `setConsultantActive(db, firmId, id, active: boolean)`
  - `addCostRate(db, firmId, consultantId, input: { hourlyCost: string; effectiveFrom: string }): Promise<Result<{ id: string }>>` (hourlyCost through `parseMoney`); `deleteCostRate(db, firmId, rateId)`
  - `ConsultantInput = { name: string; email: string; type: ConsultantType; vendorId: string | null; initialHourlyCost?: string; initialCostFrom?: string }`
- Every data fn maps errors through `mapDbError`.
- Consultant detail page has an "Invite to log in" button calling `inviteMember` (Task 9) with role `consultant` and the consultant's email.
- Pages: Manager+Admin only. Consultant form shows the Vendor select only when type = vendor.

- [ ] **Step 1: Write failing tests:**
  - create vendor + vendor-type consultant with initial cost `95` from `2026-01-01` → `getConsultant` returns `costRates[0].hourlyCost === '95.00'`.
  - employee with `vendorId` set → `fail('Vendor contractors must be linked to a vendor, and other types must not be.')`.
  - `deleteVendor` with a linked consultant → `fail('This vendor still has consultants. Reassign or remove them first.')`.
  - duplicate consultant email (case differs) → `fail('A consultant with that email already exists.')`.
  - `addCostRate` same date twice → `fail('A cost rate already starts on that date.')`; `hourlyCost: '-1'` → `ok:false` before hitting the DB.
  - `listConsultants` `currentCost` reflects the rate whose `effectiveFrom` is the latest ≤ today.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: vendors and consultants with dated cost rates`

---

### Task 12: Clients, projects and client-rate assignments

**Files:**
- Create: `src/modules/clients/*`, `src/modules/projects/*`, `src/app/f/[firmId]/clients/page.tsx`, `src/app/f/[firmId]/projects/page.tsx`, `src/app/f/[firmId]/projects/[id]/page.tsx`
- Test: `tests/integration/clients-projects.test.ts`

**Interfaces:**
- `clients/data.ts`: `listClients`, `createClient(db, firmId, input: ClientInput)`, `updateClient`, `setClientActive`, `deleteClient`. `ClientInput = { name; billingContactName?; billingEmail?; billingPhone?; billingAddress? }`.
- `projects/data.ts`:
  - `listProjects(db, firmId, opts?: { clientId?: string; status?: ProjectStatus }): Promise<Result<ProjectRow[]>>` (`ProjectRow` includes `clientName`)
  - `getProject(db, firmId, id): Promise<Result<ProjectDetail>>` (includes `assignments: { id; consultantId; consultantName; clientRate: string; effectiveFrom: string; effectiveTo: string | null }[]`)
  - `createProject(db, firmId, input: ProjectInput)`, `updateProject(db, firmId, id, input)`; `ProjectInput = { clientId; name; code?; status; startDate?; endDate? }`
  - `addAssignment(db, firmId, input: { projectId; consultantId; clientRate: string; effectiveFrom: string; effectiveTo?: string | null }): Promise<Result<{ id: string }>>`
  - `endAssignment(db, firmId, assignmentId, effectiveTo: string): Promise<Result<void>>`
  - `changeClientRate(db, firmId, assignmentId, input: { clientRate: string; effectiveFrom: string }): Promise<Result<{ id: string }>>` — ends the current assignment the day before `effectiveFrom` and inserts the new one; implemented as a single Postgres function `public.change_client_rate(p_assignment uuid, p_rate numeric, p_from date) returns uuid` (security invoker, so RLS applies) to keep it atomic. Add it to a new migration `20261108000006_change_client_rate.sql`. Rejects `p_from <= effective_from` of the current row with `raise exception 'RATE_DATE_INVALID'`; add `RATE_DATE_INVALID` → "The new rate must start after the current rate's start date." to `mapDbError` (and its test).
  - `listMyAssignments(db, firmId)` → wraps `rpc('my_assignments')`
- Project detail page: assignment table (consultant, client rate, period, current cost rate for reference, margin per hour), "Assign consultant" form, "Change rate" and "End" actions.

- [ ] **Step 1: Write failing tests:**
  - create client → project → `addAssignment` rate `180` open-ended → `getProject` shows it.
  - `changeClientRate` to `200` from `2026-07-01` → old row `effectiveTo = '2026-06-30'`, new row open-ended `'200.00'`; audit_log has both changes.
  - `changeClientRate` with `effectiveFrom` equal to the current start → `fail("The new rate must start after the current rate's start date.")`, nothing changed.
  - overlapping `addAssignment` → overlap message from Task 7 table.
  - `deleteClient` with a project → `fail('This client still has projects.')`.
  - project `endDate` before `startDate` → date message.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (migration, data fns, pages). **Step 4:** `db:reset && db:types`; run → PASS.
- [ ] **Step 5: Commit** `feat: clients, projects and dated client-rate assignments`

---

### Task 13: Consultant "My projects" and dashboard

**Files:**
- Create: `src/app/f/[firmId]/my-projects/page.tsx`
- Modify: `src/app/f/[firmId]/page.tsx`
- Test: `tests/e2e/foundation.spec.ts` (consultant section)

**Interfaces:**
- Consumes: `listMyAssignments` (Task 12), `requireFirmRole` (Task 8).
- My projects: table of project name, code, client, period — active and future only (`effective_to` null or ≥ today). Empty state: "You aren't assigned to any projects yet."
- Dashboard: Admin/Manager see counts of active consultants, clients, active projects, and a "Finish setup" checklist (logo set, at least one client, one project, one assignment) linking to each page; Consultant sees a link to My projects.

- [ ] **Step 1: Write failing e2e test:** consultant with one assignment sees the project and client name on My projects and the page source contains no rate value (`180`); consultant with none sees the empty-state text.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: consultant projects view and dashboard`

---

### Task 14: End-to-end foundation flow and README

**Files:**
- Modify: `tests/e2e/foundation.spec.ts`
- Create: `README.md`

**Interfaces:**
- Consumes all earlier tasks.

- [ ] **Step 1: Write the e2e test** `platform owner to first assignment`: owner (seed user) logs in → `/platform/firms` → creates "Acme Consulting" with admin `admin@acme.test`; admin user (pre-created with password by the fixture so no email is needed — the invite links to the existing account) logs in → settings: pattern `ACME-{YYYY}-{SEQ:4}`, uploads `tests/e2e/fixtures/logo.png` → invites `manager@acme.test` as Manager; manager logs in → creates vendor "Northwind", vendor consultant "Dana" cost `90`, client "Globex", project "Portal" (code `GLX-1`), assigns Dana at `150` from today → project page shows margin `60.00`.
- [ ] **Step 2:** Run `npm run test:e2e` → PASS (fix any gaps found).
- [ ] **Step 3:** Write `README.md`: prerequisites (Node 22, Docker Desktop), `npm i`, `npx supabase start`, copying keys into `.env.local` / `.env.test.local`, `npm run db:reset` (seeds the local platform owner `owner@local.test`), `npm run dev`, and the three test commands. Note how to make a hosted user a platform owner: `update profiles set is_platform_owner = true where email = '...'` in the Supabase SQL editor.
- [ ] **Step 4:** Run full gate: `npm run lint && npm run typecheck && npm run test:unit && npm run test:int && npm run test:e2e` → all pass.
- [ ] **Step 5: Commit** `test: end-to-end foundation flow; docs: README`
