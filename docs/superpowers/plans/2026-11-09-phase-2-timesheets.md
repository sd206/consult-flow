# Phase 2: Timesheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consultants fill in a weekly grid of hours per project and day, submit it, and Managers approve (freezing client and cost rates onto each entry) or reject it with a comment, with a week status list showing who hasn't submitted.

**Architecture:** Two new tables (`timesheets`, `time_entries`) that the browser can read but never write directly. Every write goes through a `security definer` Postgres function that checks who is calling, locks the timesheet row, and enforces the state machine. A validation trigger on `time_entries` enforces the per-entry rules. Consultants read their own entries through a function that never returns rates. The TypeScript module follows the Phase 1 pattern: data functions take a `SupabaseClient` and return `Result<T>`, and thin `'use server'` actions wrap them.

**Tech Stack:** As Phase 1: Next.js 15 App Router, React 19, Supabase (Postgres 17) via `@supabase/supabase-js` 2 / `@supabase/ssr`, Zod, Tailwind 4 + shadcn/ui, Vitest 3, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-consulting-ops-design.md` — sections 3.2 (timesheet rows), 4.2, 5.1 (items 1–6), 7, 9 phase 2.

## Global Constraints

- Everything in Phase 1's Global Constraints still holds: standard business columns (`id`, `firm_id`, `created_at`, `created_by`, `updated_at` + `set_updated_at()` trigger), composite `(firm_id, x_id)` foreign keys with `unique (firm_id, id)` on referenced tables, RLS on every table, nothing readable by `anon`, `Result<T>` from data functions, user-facing errors only via `mapDbError`.
- Every new SQL function: `set search_path = ''`, fully qualified names, and `revoke execute ... from public, anon` followed by an explicit `grant execute ... to authenticated`.
- Hours are `numeric(5,2)`, `> 0` and `<= 24` per entry. Hours and money travel as strings (`::text` in SQL) and are never added with JS `number`; use `sumHours` (Task 1).
- Week starts on **Monday**. "Today" is `current_date` in Postgres and `todayIso()` in TypeScript (both UTC).
- No future weeks: a timesheet's `week_start` must be ≤ the Monday of the current week.
- Statuses: `draft | submitted | approved | rejected` (enum `timesheet_status`). Editable states: `draft`, `rejected`.
- Consultants never receive a rate value (client or cost) in any response, page, or page source.
- Migration file names continue the sequence: `20261109000010_timesheets.sql`, `20261109000011_timesheet_workflow.sql`.
- After any migration: `npm run db:reset && npm run db:types`.
- E2E tests run against a production build with `workers: 1` (existing `playwright.config.ts`); each test creates its own firm via `newFirm()`.

## Review Focus

1. **Client rate changes mid-week** (rate 150 Mon–Tue, 175 from Wed): approving snapshots 150 on Mon/Tue entries and 175 on Wed+. Test in Task 3.
2. **Assignment ends mid-week** (ends Wednesday): the grid disables Thu–Sun for that project, and a forged save for Thursday is rejected with "You're not assigned to that project on one of those days." Tests in Tasks 2 and 5.
3. **Cost rate starts after a worked day:** approve fails with the cost-rate message, and the timesheet stays `submitted` with no snapshots written (atomic). Test in Task 3.
4. **Stale tab after submit:** saving a week that is already submitted fails with "This timesheet is submitted or approved and can't be edited." and changes nothing. Test in Task 2.
5. **Clearing every cell, then submitting:** the save removes all entries (timesheet stays `draft`), and submit fails with "Add some hours before submitting." Tests in Tasks 2 and 3.

---

## File Structure

```
supabase/migrations/
  20261109000010_timesheets.sql            # enum, tables, RLS, validation trigger, read fns, save fn
  20261109000011_timesheet_workflow.sql    # submit / approve / reject / reopen, audit trigger
src/lib/
  domain/weeks.ts   domain/weeks.test.ts    # Monday maths, future-week check
  domain/hours.ts   domain/hours.test.ts    # parseHours, sumHours
  db-errors.ts      db-errors.test.ts       # + timesheet messages
  db-types.ts                               # + TimesheetStatus
src/modules/timesheets/
  schemas.ts  data.ts  actions.ts  week-projects.ts  week-projects.test.ts
src/app/f/[firmId]/
  layout.tsx                                # + "My timesheet", "Timesheets" nav items
  page.tsx                                  # + awaiting-approval count / timesheet link
  timesheet/page.tsx  timesheet/week-grid.tsx          # weekly grid (own, or on behalf)
  timesheets/page.tsx                                   # queue + week status (managers)
  timesheets/[id]/page.tsx  timesheets/[id]/review-actions.tsx
tests/integration/
  timesheet-fixtures.ts  timesheets-db.test.ts  timesheets.test.ts
tests/e2e/timesheets.spec.ts
```

---

### Task 1: Week and hours helpers, error messages

**Files:**
- Create: `src/lib/domain/weeks.ts`, `src/lib/domain/weeks.test.ts`, `src/lib/domain/hours.ts`, `src/lib/domain/hours.test.ts`
- Modify: `src/lib/db-errors.ts`, `src/lib/db-errors.test.ts`

**Interfaces:**
- Produces in `weeks.ts` (all dates are `YYYY-MM-DD` strings, UTC):
  - `addDays(date: string, n: number): string`
  - `weekStartOf(date: string): string` — the Monday on or before `date`
  - `weekDays(weekStart: string): string[]` — 7 dates, Monday to Sunday
  - `currentWeekStart(now?: Date): string` — `weekStartOf(todayIso(now))`
  - `isFutureWeek(weekStart: string, now?: Date): boolean`
  - `formatDayLabel(date: string): string` — e.g. `'Mon 9 Nov'` (en-GB weekday short + day + month short, UTC)
- Produces in `hours.ts`:
  - `parseHours(input: string): Result<string>` — trims; accepts `^\d{0,2}(\.\d{1,2})?$` with at least one digit; value must be > 0 and ≤ 24; returns a 2-dp string. Failure message: `'Enter hours between 0.01 and 24, up to 2 decimal places.'`
  - `sumHours(values: string[]): string` — exact sum via integer hundredths (BigInt), 2-dp string; `[]` → `'0.00'`
- `mapDbError` gains these `BY_MATCH` rows (needle → message):

| Needle | Message |
|---|---|
| `TIMESHEET_LOCKED` | This timesheet is submitted or approved and can't be edited. |
| `TIMESHEET_STATE` | This timesheet can't be changed in its current state. |
| `TIMESHEET_EMPTY` | Add some hours before submitting. |
| `TIMESHEET_NOT_FOUND` | Timesheet not found. |
| `TIMESHEET_INVOICED` | This timesheet has invoiced hours, so it can't be reopened. |
| `FUTURE_WEEK` | You can't enter time for a future week. |
| `timesheets_week_start_monday_chk` | Weeks start on Monday. |
| `ENTRY_OUTSIDE_WEEK` | Each day must fall within the timesheet's week. |
| `NO_ASSIGNMENT` | You're not assigned to that project on one of those days. |
| `DAY_OVER_24` | A day can't have more than 24 hours in total. |
| `time_entries_hours_chk` | Enter hours between 0.01 and 24, up to 2 decimal places. |
| `time_entries_cell_key` | That project already has hours on that day. |
| `COST_RATE_MISSING` | This consultant has no cost rate for a day worked. Add a cost rate starting on or before that day, then approve. |
| `REJECT_COMMENT_REQUIRED` | Add a comment saying what needs to change. |
| `CONSULTANT_NOT_FOUND` | Consultant not found. |

- [ ] **Step 1: Write failing unit tests:**
  - `weekStartOf('2026-11-15')` → `'2026-11-09'` (Sunday); `weekStartOf('2026-11-09')` → `'2026-11-09'`; `weekStartOf('2027-01-01')` → `'2026-12-28'`.
  - `weekDays('2026-11-09')` → length 7, first `'2026-11-09'`, last `'2026-11-15'`; `addDays('2026-12-31', 1)` → `'2027-01-01'`.
  - `currentWeekStart(new Date('2026-11-11T23:30:00Z'))` → `'2026-11-09'`.
  - `isFutureWeek('2026-11-16', new Date('2026-11-15T12:00:00Z'))` → true; `isFutureWeek('2026-11-09', same)` → false.
  - `formatDayLabel('2026-11-09')` → `'Mon 9 Nov'`.
  - `parseHours`: `'8'`→`'8.00'`, `'7.5'`→`'7.50'`, `'.25'`→`'0.25'`, `' 24 '`→`'24.00'`; failures for `'0'`, `'24.01'`, `'7,5'`, `'1.234'`, `''`, `'-1'`, `'abc'`.
  - `sumHours(['7.50','0.25','8'])` → `'15.75'`; `sumHours([])` → `'0.00'`.
  - `mapDbError` returns each new message for an error whose `message` contains its needle (one table-driven test).
- [ ] **Step 2:** Run `npm run test:unit` → FAIL (modules missing).
- [ ] **Step 3:** Implement the functions and table rows above.
- [ ] **Step 4:** Run `npm run test:unit` → PASS.
- [ ] **Step 5: Commit** `feat(domain): week and hours helpers; timesheet error messages`

---

### Task 2: Timesheet tables, validation and save function

**Files:**
- Create: `supabase/migrations/20261109000010_timesheets.sql`, `tests/integration/timesheet-fixtures.ts`, `tests/integration/timesheets-db.test.ts`
- Modify: `src/lib/db-types.ts` (add `TimesheetStatus`), `src/lib/supabase/types.ts` (regenerated)

**Interfaces:**
- Produces enum `public.timesheet_status ('draft','submitted','approved','rejected')`.
- Produces `public.timesheets`: standard columns + `consultant_id uuid not null`, `week_start date not null`, `status timesheet_status not null default 'draft'`, `submitted_at timestamptz`, `decided_by uuid references profiles(user_id) on delete set null`, `decided_at timestamptz`, `decision_comment text`. Constraints: `timesheets_firm_id_id_key unique (firm_id, id)`; `timesheets_consultant_fk (firm_id, consultant_id) → consultants (firm_id, id) on delete restrict`; `timesheets_consultant_week_key unique (consultant_id, week_start)`; `timesheets_week_start_monday_chk check (extract(isodow from week_start) = 1)`. Index `(firm_id, status, week_start)`.
- Produces `public.time_entries`: standard columns + `timesheet_id uuid not null`, `project_id uuid not null`, `work_date date not null`, `hours numeric(5,2) not null`, `note text`, `client_rate_snapshot numeric(12,2)`, `cost_rate_snapshot numeric(12,2)`, `invoice_line_id uuid` (no FK yet — Phase 3 adds it). Constraints: `time_entries_timesheet_fk (firm_id, timesheet_id) → timesheets on delete cascade`; `time_entries_project_fk (firm_id, project_id) → projects on delete restrict`; `time_entries_hours_chk check (hours > 0 and hours <= 24)`; `time_entries_cell_key unique (timesheet_id, project_id, work_date)`. Index `(firm_id, project_id, work_date)`.
- Privileges: `revoke all ... from anon, authenticated; grant select ... to authenticated`. **No insert/update/delete grants** — writes happen only in functions.
- RLS select: `timesheets` → `has_role(firm_id,'{admin,manager}')` or the timesheet's consultant has `user_id = auth.uid()`. `time_entries` → `has_role(firm_id,'{admin,manager}')` only (consultants read via `timesheet_entries`, which hides rates).
- Produces helper `public.can_edit_consultant_time(p_firm uuid, p_consultant uuid) returns boolean` (security definer, stable): true when `has_role(p_firm,'{admin,manager}')`, or the consultant row in `p_firm` has `user_id = auth.uid()` and `is_member(p_firm)`.
- Produces trigger function `public.time_entries_validate()` (security definer), fired `before insert or update of project_id, work_date, hours, note on time_entries`. It loads the parent timesheet and raises (errcode `P0001`) in this order:
  - `TIMESHEET_LOCKED` if status not in (`draft`,`rejected`)
  - `ENTRY_OUTSIDE_WEEK` if `work_date` not in `[week_start, week_start + 6]`
  - `NO_ASSIGNMENT` if no `project_assignments` row for (firm, project, timesheet's consultant) has `effective_from <= work_date` and (`effective_to` is null or `>= work_date`)
  - `DAY_OVER_24` if the sum of hours for that consultant on `work_date` across their entries (excluding this row's old version, including the new) exceeds 24
- Produces `public.save_timesheet_week(p_firm uuid, p_consultant uuid, p_week_start date, p_entries jsonb) returns uuid` (security definer, volatile). Behaviour:
  1. `CONSULTANT_NOT_FOUND` if the consultant isn't in `p_firm`; `42501` if `not can_edit_consultant_time(p_firm, p_consultant)`.
  2. `FUTURE_WEEK` if `p_week_start > date_trunc('week', current_date)::date`. (The Monday check is the table constraint.)
  3. Insert the timesheet as `draft` if missing (`on conflict (consultant_id, week_start) do nothing`), then `select ... for update` it.
  4. `TIMESHEET_LOCKED` if status not in (`draft`,`rejected`).
  5. Delete all its entries, then insert one row per element of `p_entries` with `firm_id = p_firm` (the composite project FK then rejects another firm's project) (`[{ "projectId": uuid, "workDate": "YYYY-MM-DD", "hours": "7.50", "note": string|null }]`). An empty array is valid and leaves the timesheet with no entries.
  6. Return the timesheet id.
- Produces read functions (security definer, stable; both raise `42501` unless `can_edit_consultant_time`):
  - `public.week_projects(p_firm uuid, p_consultant uuid, p_week_start date) returns table (assignment_id uuid, project_id uuid, project_name text, project_code text, client_name text, effective_from date, effective_to date)` — assignments for the consultant that overlap `[p_week_start, p_week_start + 6]`, ordered by client name, project name, effective_from.
  - `public.timesheet_entries(p_timesheet uuid) returns table (id uuid, project_id uuid, work_date date, hours text, note text)` — no rate columns; `hours` as `::text`.
- Produces `tests/integration/timesheet-fixtures.ts`:
  - `seedTimesheetFixture(f: Awaited<ReturnType<typeof newFirm>>, opts?: { clientRate?: string; costRate?: string; costFrom?: string; assignFrom?: string; assignTo?: string | null }): Promise<{ clientId: string; projectId: string; consultantId: string; assignmentId: string }>` — uses `adminDb()`; consultant linked to `f.consultant.id`; defaults: client rate `'150'`, cost `'90'` from `'2026-01-01'`, assignment from `'2026-01-01'` open-ended.
  - Constants `PAST_WEEK = '2026-10-05'` and `FUTURE_WEEK = '2027-01-04'` (both Mondays).
- `src/lib/db-types.ts` adds `export type TimesheetStatus = Database['public']['Enums']['timesheet_status']`.

- [ ] **Step 1: Write failing tests** in `timesheets-db.test.ts` (calls via `db.rpc`):
  - `consultant saves own week`: `save_timesheet_week` with Mon 8h note "Kickoff" + Tue 7.5h → returns id; `timesheet_entries` returns 2 rows with `hours` `'8.00'`, `'7.50'`, and no key containing `rate`.
  - `save replaces the week`: save again with only Wed 4h → `timesheet_entries` returns exactly that row.
  - `empty save clears entries`: save `[]` → 0 entries; timesheet status still `draft`.
  - `future week rejected`: `FUTURE_WEEK` → error contains `FUTURE_WEEK`.
  - `non-Monday rejected`: `'2026-10-06'` → error contains `timesheets_week_start_monday_chk`.
  - `outside the week rejected`: work date `'2026-10-12'` in the `PAST_WEEK` save → `ENTRY_OUTSIDE_WEEK`; no entries stored.
  - `assignment ending mid-week`: fixture `assignTo: '2026-10-07'` (Wed); Thu entry → `NO_ASSIGNMENT`; Wed entry → ok.
  - `24h per day across projects`: second project assignment; 16h + 9h on one day → `DAY_OVER_24`; 16h + 8h → ok.
  - `hours bounds`: `"0"` and `"24.5"` → error contains `time_entries_hours_chk`.
  - `locked after submit`: set status `submitted` via `adminDb`, then save → `TIMESHEET_LOCKED`; entries unchanged.
  - `manager saves on behalf`: manager calls `save_timesheet_week` for the consultant → ok.
  - `other consultant blocked`: a second consultant user in the same firm (not linked) saving for the fixture consultant → permission error (code `42501`); same for `week_projects` and `timesheet_entries`.
  - `other firm blocked`: firm B's admin calling with firm A's ids → error; firm B's admin selecting `timesheets`/`time_entries` → 0 rows.
  - `no direct writes`: consultant `insert` into `time_entries` and `update` on `timesheets` → error / 0 rows.
  - `consultant cannot read entries table`: consultant `select` on `time_entries` → 0 rows; on own `timesheets` → 1 row.
  - `week_projects`: assignment rate change mid-week (two rows) → both rows returned with their dates; an assignment ending before the week → not returned.
- [ ] **Step 2:** Run `npm run test:int -- timesheets-db` → FAIL.
- [ ] **Step 3:** Write the migration and fixture file per Interfaces.
- [ ] **Step 4:** `npm run db:reset && npm run db:types`; run `npm run test:int -- timesheets-db` → PASS; run `npm run test:int` → all PASS.
- [ ] **Step 5: Commit** `feat(db): timesheets and time entries with validation and week save`

---

### Task 3: Submit, approve, reject, reopen

**Files:**
- Create: `supabase/migrations/20261109000011_timesheet_workflow.sql`
- Modify: `tests/integration/timesheets-db.test.ts`, `src/lib/supabase/types.ts` (regenerated)

**Interfaces:**
- All four functions are `security definer`, take the timesheet id, `select ... for update` the row (raise `TIMESHEET_NOT_FOUND` if missing), and raise `TIMESHEET_STATE` for any transition not listed:
  - `public.submit_timesheet(p_timesheet uuid) returns void` — caller `can_edit_consultant_time`; `draft|rejected → submitted`; `TIMESHEET_EMPTY` if it has no entries; sets `submitted_at = now()`.
  - `public.approve_timesheet(p_timesheet uuid) returns void` — caller `has_role(firm,'{admin,manager}')` (else `42501`), including approving their own timesheet; `submitted → approved`. In the same transaction, for every entry: `client_rate_snapshot` = `client_rate` of the assignment in effect on `work_date` (`NO_ASSIGNMENT` if none), `cost_rate_snapshot` = `hourly_cost` of the consultant's cost rate with the latest `effective_from <= work_date` (`COST_RATE_MISSING` if none). Sets `decided_by = auth.uid()`, `decided_at = now()`, `decision_comment = null`.
  - `public.reject_timesheet(p_timesheet uuid, p_comment text) returns void` — managers; `submitted → rejected`; `REJECT_COMMENT_REQUIRED` if `btrim(coalesce(p_comment,'')) = ''`; stores the trimmed comment, `decided_by`, `decided_at`.
  - `public.reopen_timesheet(p_timesheet uuid) returns void` — managers; `approved → draft`; `TIMESHEET_INVOICED` if any entry has `invoice_line_id` not null; clears both snapshots on every entry and sets `submitted_at`, `decided_by`, `decided_at`, `decision_comment` to null.
- Adds `timesheets_audit` trigger (`after insert or update or delete ... execute function public.audit_row()`).
- Ruling recorded here: project `status` (`on_hold`/`closed`) does not block time entry or approval; the assignment dates alone decide.

- [ ] **Step 1: Write failing tests** (append to `timesheets-db.test.ts`):
  - `full cycle`: consultant saves and submits → `submitted`, `submitted_at` set; consultant save now → `TIMESHEET_LOCKED`; manager approves → `approved`, every entry has `client_rate_snapshot '150.00'`, `cost_rate_snapshot '90.00'` (read via `adminDb` with `::text`); `audit_log` has `timesheets` updates.
  - `rate change mid-week` (Review Focus 1): change client rate to `175` from `'2026-10-07'` via `rpc('change_client_rate')`; entries Mon and Wed → snapshots `150.00` and `175.00`.
  - `cost rate missing` (Review Focus 3): fixture `costFrom: '2026-10-06'`; Mon entry; approve → `COST_RATE_MISSING`; status still `submitted`; snapshots null.
  - `empty submit` (Review Focus 5): save `[]`, submit → `TIMESHEET_EMPTY`.
  - `consultant cannot approve or reject own`: → permission error (code `42501`).
  - `manager approves own timesheet`: manager linked to their own consultant record submits and approves → `approved`, `decided_by` = manager id.
  - `reject needs a comment`: `'  '` → `REJECT_COMMENT_REQUIRED`; `'Split by task'` → `rejected` with comment; consultant edits and resubmits → `submitted`.
  - `approve from draft` → `TIMESHEET_STATE`.
  - `reopen`: approved → `draft`, snapshots null, decision fields null; consultant can save again.
  - `reopen invoiced`: set one entry's `invoice_line_id` to a random uuid via `adminDb`; reopen → `TIMESHEET_INVOICED`.
  - `other firm cannot act`: firm B admin calling each function on firm A's timesheet → error, state unchanged.
- [ ] **Step 2:** Run `npm run test:int -- timesheets-db` → FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `npm run db:reset && npm run db:types`; `npm run test:int` → all PASS.
- [ ] **Step 5: Commit** `feat(db): timesheet submit, approve with rate snapshots, reject, reopen`

---

### Task 4: Timesheets data module

**Files:**
- Create: `src/modules/timesheets/data.ts`, `schemas.ts`, `actions.ts`, `week-projects.ts`, `week-projects.test.ts`
- Test: `tests/integration/timesheets.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2–3 SQL functions, `mapDbError`, `Result`, `FormResult`/`fieldErrorsOf`/`str` from `src/lib/form.ts`, `requireFirmRole`.
- Types (in `data.ts`):
  - `WeekStatus = TimesheetStatus | 'not_started'`
  - `WeekProject = { projectId: string; projectName: string; projectCode: string | null; clientName: string; activeDays: string[] }`
  - `WeekEntry = { id: string; projectId: string; workDate: string; hours: string; note: string | null }`
  - `EntryInput = { projectId: string; workDate: string; hours: string; note: string | null }`
  - `TimesheetWeek = { consultantId: string; consultantName: string; weekStart: string; timesheetId: string | null; status: WeekStatus; decisionComment: string | null; projects: WeekProject[]; entries: WeekEntry[]; totalHours: string; editable: boolean }` — `editable` = status in `not_started|draft|rejected`.
  - `QueueRow = { timesheetId: string; consultantName: string; weekStart: string; totalHours: string; submittedAt: string }`
  - `WeekStatusRow = { consultantId: string; consultantName: string; timesheetId: string | null; status: WeekStatus; totalHours: string }`
  - `ReviewEntry = WeekEntry & { clientRateSnapshot: string | null; costRateSnapshot: string | null }`
  - `ReviewTimesheet = Omit<TimesheetWeek, 'timesheetId' | 'entries' | 'editable'> & { timesheetId: string; entries: ReviewEntry[]; submittedAt: string | null; decidedAt: string | null }`
- `week-projects.ts`: `groupWeekProjects(rows: WeekProjectRow[], days: string[]): WeekProject[]` where `WeekProjectRow` mirrors `week_projects` output in camelCase. One `WeekProject` per project, `activeDays` = the days covered by any of its rows, in order.
- Functions in `data.ts` (all `(db: SupabaseClient, firmId: string, ...)`, returning `Result`):
  - `getMyConsultant(db, firmId): Promise<Result<{ id: string; name: string } | null>>`
  - `getTimesheetWeek(db, firmId, consultantId, weekStart): Promise<Result<TimesheetWeek>>` — `fail('Weeks start on Monday.')` if `weekStart` isn't a Monday ISO date. Projects that have entries but no row from `week_projects` still appear, with `activeDays: []`, so existing hours stay visible.
  - `saveTimesheetWeek(db, firmId, consultantId, weekStart, entries: EntryInput[]): Promise<Result<{ timesheetId: string }>>`
  - `submitTimesheet(db, firmId, timesheetId)`, `approveTimesheet(db, firmId, timesheetId)`, `reopenTimesheet(db, firmId, timesheetId)`: `Promise<Result<void>>`
  - `rejectTimesheet(db, firmId, timesheetId, comment: string): Promise<Result<void>>`
  - `listAwaitingApproval(db, firmId): Promise<Result<QueueRow[]>>` — status `submitted`, oldest week first
  - `listWeekStatus(db, firmId, weekStart): Promise<Result<WeekStatusRow[]>>` — every **active** consultant, ordered by name; `not_started` with `'0.00'` when there's no timesheet
  - `getTimesheetForReview(db, firmId, timesheetId): Promise<Result<ReviewTimesheet>>` — managers only (reads `time_entries` directly)
- `schemas.ts`: `parseWeekForm(formData: FormData, cells: { projectId: string; workDate: string }[]): FormResult<EntryInput[]>` — fields `h:{projectId}:{workDate}` and `n:{projectId}:{workDate}`; blank hours → no entry; hours via `parseHours`; a note with blank hours → field error `'Add hours for this note.'` on the `n:` key; notes trimmed, max 500 chars (`'Keep notes under 500 characters.'`), empty → null.
- `actions.ts` (`'use server'`): `saveWeekAction(firmId, consultantId, weekStart, formData)`, `submitWeekAction(firmId, consultantId, weekStart, formData)` (saves, then submits), `approveAction(firmId, timesheetId)`, `rejectAction(firmId, timesheetId, formData)` (field `comment`), `reopenAction(firmId, timesheetId)`. Each calls `requireFirmRole` with all roles for save/submit (the database decides who may edit whose time) and managers only for approve/reject/reopen. Each re-derives the allowed cells from `getTimesheetWeek` (never trusts cell lists from the client) and revalidates `/f/{firmId}/timesheet` and `/f/{firmId}/timesheets`.

- [ ] **Step 1: Write failing tests:**
  - Unit `week-projects.test.ts`: two rows for one project (Mon–Tue at one rate, Wed–open at another) → one `WeekProject` with all 7 `activeDays`; a row ending Wed → `activeDays` Mon–Wed; two projects sorted as given.
  - Unit (in `week-projects.test.ts` or a sibling `schemas.test.ts`): `parseWeekForm` with `h:P:2026-10-05=8`, `n:P:2026-10-05=Kickoff`, blank Tue → one `EntryInput`; note without hours → field error on `n:P:2026-10-06`; hours `'25'` → field error on the `h:` key.
  - Integration `timesheets.test.ts`: `getMyConsultant` → fixture consultant for the linked user, `null` for the manager (not linked); `getTimesheetWeek` for a fresh week → `status 'not_started'`, `editable true`, one project with 7 `activeDays`; save, submit → `getTimesheetWeek` → `submitted`, `editable false`, `totalHours '15.50'`; `listAwaitingApproval` (manager) → that row; `approveTimesheet` → `getTimesheetForReview` entries carry `'150.00'` / `'90.00'`; `listWeekStatus` with two active consultants (one never started) and one inactive → two rows, statuses `approved` and `not_started`; `rejectTimesheet` error path returns the mapped message (`'Add a comment saying what needs to change.'`); `getTimesheetWeek` with `'2026-10-06'` → `fail('Weeks start on Monday.')`.
- [ ] **Step 2:** Run `npm run test:unit && npm run test:int -- timesheets` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both → PASS; `npm run typecheck && npm run lint` → clean.
- [ ] **Step 5: Commit** `feat(timesheets): data module, form parsing and server actions`

---

### Task 5: Weekly timesheet grid

**Files:**
- Create: `src/app/f/[firmId]/timesheet/page.tsx`, `src/app/f/[firmId]/timesheet/week-grid.tsx`
- Modify: `src/app/f/[firmId]/layout.tsx` (nav item `My timesheet` → `/timesheet`, all roles, placed after `My projects`)
- Test: `tests/e2e/timesheets.spec.ts` (grid section)

**Interfaces:**
- Consumes: Task 4 data functions and actions; Task 1 `weekDays`, `currentWeekStart`, `isFutureWeek`, `addDays`, `weekStartOf`, `formatDayLabel`, `sumHours`.
- Route: `/f/{firmId}/timesheet?week=YYYY-MM-DD&consultant={id}`.
  - `week` missing → current week. A non-Monday → normalise with `weekStartOf`. A future week → redirect to the current week.
  - `consultant` present → `requireFirmRole(firmId, ['admin','manager'])`, else 404; heading `Timesheet: {consultant name}`. Absent → own consultant via `getMyConsultant`; if `null`, show `"Your login isn't linked to a consultant record yet. Ask an Admin to link it."` and nothing else.
- Page shows: heading `Week of {formatDayLabel(weekStart)}`; links `Previous week` / `Next week` (`Next week` not rendered when the next week is in the future); status text (`Not started`, `Draft`, `Submitted`, `Approved`, `Rejected`); when `rejected`, the comment in a box labelled `Changes requested:`.
- Grid (`week-grid.tsx`, client component): rows = projects (`{project name} · {client name}`), columns = 7 days (`formatDayLabel`) + row total; footer row of day totals and week total (computed live with `sumHours` on valid inputs). Each cell has an hours `<input inputMode="decimal" aria-label="Hours {project name} {day label}">` and a note `<input aria-label="Note {project name} {day label}">`. Cells not in `activeDays` are disabled. When not `editable`, all inputs are read-only and there are no buttons. Buttons: `Save draft`, `Submit`. Field errors show under the cell; the action-level error shows in a `role="alert"` box. Empty state when there are no projects: `"No projects assigned for this week."`
- Contains no rate values (the data it receives has none).

- [ ] **Step 1: Write failing e2e tests** in `timesheets.spec.ts` (use `newFirm` + `seedTimesheetFixture` with `assignFrom` well in the past; compute the current Monday with `currentWeekStart()`):
  - `consultant fills and submits the current week`: log in as consultant → nav `My timesheet` → fill `Hours Portal {Mon label}` = `8`, note `Kickoff`, Tue = `7.5` → `Save draft` → reload → values persist, week total `15.50` → `Submit` → status `Submitted`, inputs read-only, no `Submit` button.
  - `assignment ending mid-week disables later days`: fixture `assignTo` = current Wednesday → Thursday's hours input is disabled.
  - `bad hours show a field error`: enter `25` → `Save draft` → text `Enter hours between 0.01 and 24, up to 2 decimal places.`; nothing saved (reload shows empty).
  - `no future weeks`: there is no `Next week` link on the current week; visiting `?week=` next Monday lands on the current week.
  - `unlinked user`: the firm's manager (no consultant record) opens `My timesheet` → the not-linked message.
  - `consultant can't open another's timesheet`: consultant visits `?consultant={other id}` → 404.
  - `no rates in source`: page content does not contain `150` or `90.00`.
- [ ] **Step 2:** Run `npm run test:e2e -- timesheets` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(timesheets): weekly grid with save, submit and week navigation`

---

### Task 6: Manager queue, week status and review

**Files:**
- Create: `src/app/f/[firmId]/timesheets/page.tsx`, `src/app/f/[firmId]/timesheets/[id]/page.tsx`, `src/app/f/[firmId]/timesheets/[id]/review-actions.tsx`
- Modify: `src/app/f/[firmId]/layout.tsx` (nav item `Timesheets` → `/timesheets`, admin/manager, after `My timesheet`)
- Test: `tests/e2e/timesheets.spec.ts` (manager section)

**Interfaces:**
- Consumes: `listAwaitingApproval`, `listWeekStatus`, `getTimesheetForReview`, `approveAction`, `rejectAction`, `reopenAction`.
- `/timesheets` (admin/manager; others 404):
  - Section `Awaiting approval`: table (consultant, week of, hours, submitted) linking each row to `/timesheets/{id}`; empty text `"Nothing waiting for approval."`
  - Section `Week status` with `?week=` (default current week, `Previous week`/`Next week` like Task 5): table of `WeekStatusRow` (consultant, status, hours). Rows with a timesheet link to its review page; rows without one link to `/timesheet?consultant={id}&week={week}` labelled `Enter time`.
- `/timesheets/{id}` (admin/manager): read-only grid (project rows × days, hours and notes, totals) built from `ReviewTimesheet`; status; comment when rejected. When `approved`, an extra column per project row shows its client rate and cost rate snapshots (only the managers' page). Actions by status:
  - `submitted`: `Approve` button; `Reject` form with a required `comment` textarea (label `What needs to change?`).
  - `approved`: `Reopen` button.
  - `draft` / `rejected`: `Edit on their behalf` link to `/timesheet?consultant=…&week=…`.
  - Errors show in a `role="alert"` box (e.g. the cost-rate message).

- [ ] **Step 1: Write failing e2e tests:**
  - `manager rejects, consultant fixes, manager approves`: consultant's week is saved and submitted in setup via `f.consultant.db.rpc('save_timesheet_week', …)` then `rpc('submit_timesheet', …)` → manager → `Timesheets` → row in `Awaiting approval` → open → `Reject` with `Split hours by task` → consultant's `My timesheet` shows `Changes requested:` with that text and editable inputs → consultant changes Mon to `7.5` and submits → manager approves → `Week status` shows the consultant `Approved` with `7.50`.
  - `cost rate missing shows a clear error`: fixture `costFrom` after the worked day → approve → alert with the cost-rate message; status still `Submitted`.
  - `reopen`: approved timesheet → `Reopen` → status `Draft`.
  - `week status shows not started`: a second active consultant with no timesheet → `Not started` and an `Enter time` link that opens their grid with heading `Timesheet: {name}`.
  - `consultant gets 404 on /timesheets`.
- [ ] **Step 2:** Run `npm run test:e2e -- timesheets` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(timesheets): approval queue, week status and review page`

---

### Task 7: Dashboard, README and full gate

**Files:**
- Modify: `src/app/f/[firmId]/page.tsx`, `src/modules/firms/dashboard.ts`, `README.md`
- Test: `tests/integration/dashboard.test.ts`, `tests/e2e/timesheets.spec.ts`

**Interfaces:**
- `dashboard.ts` adds `awaitingApproval: number` to the counts returned for admin/manager (count of `submitted` timesheets).
- Dashboard: admin/manager see a fourth card `Awaiting approval` linking to `/timesheets`; every role sees a `My timesheet` link.
- README: a short "Timesheets" section (who can do what, weeks start Monday, no future weeks, rates frozen on approval, how to link a login to a consultant record so Managers/Admins can log their own time).

- [ ] **Step 1: Write failing tests:** `dashboard.test.ts`: one submitted timesheet → `awaitingApproval` is 1; e2e: manager dashboard shows `Awaiting approval` with `1` and the link opens `/timesheets`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement and write the README section. **Step 4:** Run the full gate: `npm run lint && npm run typecheck && npm run test:unit && npm run test:int && npm run test:e2e` → all PASS.
- [ ] **Step 5: Commit** `feat: dashboard approval count; docs: timesheets`
