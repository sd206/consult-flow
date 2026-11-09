# Consulting Ops SaaS — Design Spec

Date: 2026-11-08
Status: Approved in conversation; awaiting written-spec review

## 1. Purpose

A multi-tenant SaaS web app for small consulting firms to manage consultants, clients, projects, rates, timesheets, invoices, payments, expenses, and profit & loss reporting.

**Success for version 1:** a firm can onboard its people and clients, collect approved weekly timesheets, issue branded PDF invoices from approved hours, record payments with proof attached, record expenses with receipts, and see accurate P&L by period, client, and project — with each firm's data fully isolated from every other firm.

## 2. Decisions

| Topic | Decision |
|---|---|
| Audience | Many firms (SaaS), each in its own isolated workspace |
| Onboarding | Invite-only: the platform owner creates firms and invites each firm's first Admin. No self-signup, no subscription billing in v1 |
| Stack | Next.js (TypeScript, App Router) on Vercel + Supabase (Postgres, Auth, Storage, Row-Level Security) |
| Consultant cost | Every consultant has an hourly cost rate (vendor rate, contractor pay rate, or employee loaded cost) |
| Tasks | Free-text task note on each time entry in v1; structured project task list is a later phase |
| Invoice parties | Firm (logo, address, contact) as issuer; client billing details as bill-to |
| Timesheet approval | Required: consultants submit weekly, Managers approve/reject; only approved hours are invoiceable |
| Expenses | Entered by Managers/Admins only in v1 |
| P&L basis | Accrual by date worked, with Invoiced and Collected shown alongside |
| Currency / tax | One currency per firm; optional single tax percentage per invoice (firm default, editable per invoice) |
| Money types | `numeric(12,2)` for money, `numeric(5,2)` for hours; never floating point |

## 3. Architecture

- One Next.js application. Server Components and Server Actions perform reads and writes; no separate API server.
- One Supabase project: Postgres for data, Supabase Auth for sign-in (email invite with magic link or password), Supabase Storage for logos and attachments.
- Invoice PDFs are rendered server-side (React-PDF) from the invoice record and its template, and stored in Storage on issue.
- Code is organised by module, each owning its migrations, RLS policies, server functions, and pages:
  `firms`, `people`, `clients-projects`, `rates`, `timesheets`, `invoices`, `payments`, `expenses`, `reports`.
- Shared pure-logic library (no I/O) for: rate lookup by date, money arithmetic and rounding, invoice-number formatting, P&L aggregation. This is where most unit tests live.

### 3.1 Tenancy

- Every business table has a non-null `firm_id`.
- Postgres Row-Level Security is enabled on every business table. Policies allow access only when `auth.uid()` is a member of the row's firm with a permitted role.
- Helper SQL functions: `is_member(firm_id)`, `has_role(firm_id, roles[])`.
- Storage paths are `firms/{firm_id}/...`; Storage policies apply the same membership check.
- The service-role key is used only in server code for platform-owner operations and is never sent to the browser.

### 3.2 Roles and permissions

One role per user per firm.

| Capability | Platform owner | Admin | Manager | Consultant |
|---|---|---|---|---|
| Create firms, invite first Admin | ✓ | | | |
| See firm business data | | ✓ | ✓ | own only |
| Manage users and roles | | ✓ | | |
| Firm settings (logo, address, currency, tax, number pattern, templates) | | ✓ | | |
| Consultants, vendors, clients, projects, rates | | ✓ | ✓ | |
| Approve/reject timesheets | | ✓ | ✓ | |
| Invoices, payments, expenses, reports | | ✓ | ✓ | |
| Enter and submit own timesheet | | ✓ | ✓ | ✓ |
| See own assigned projects (without rates) | | ✓ | ✓ | ✓ |

- Platform owner is a flag on the user profile, outside firm membership; it has no access to firm business data.
- An Admin cannot remove or demote the last Admin of a firm.
- Managers may enter or edit draft time on behalf of any consultant.

## 4. Data model

All business tables include `id uuid`, `firm_id`, `created_at`, `created_by`, `updated_at`.

### 4.1 Setup and people

- **firms**: `name`, `logo_path`, `address`, `contact_name`, `contact_email`, `contact_phone`, `currency` (ISO 4217), `default_tax_percent`, `invoice_number_pattern`, `invoice_next_seq`, `default_payment_terms_days`
- **profiles**: `user_id`, `display_name`, `is_platform_owner`
- **firm_members**: `firm_id`, `user_id`, `role` (`admin` | `manager` | `consultant`), unique (`firm_id`, `user_id`)
- **vendors**: `name`, `contact_name`, `email`, `phone`, `address`
- **consultants**: `name`, `email`, `type` (`employee` | `independent` | `vendor`), `vendor_id` (required iff type = vendor; check constraint), `user_id` (nullable link to login), `active`
- **consultant_cost_rates**: `consultant_id`, `hourly_cost`, `effective_from`; unique (`consultant_id`, `effective_from`)
- **clients**: `name`, `billing_contact_name`, `billing_email`, `billing_phone`, `billing_address`, `active`
- **projects**: `client_id`, `name`, `code`, `status` (`active` | `on_hold` | `closed`), `start_date`, `end_date`
- **project_assignments**: `project_id`, `consultant_id`, `client_rate`, `effective_from`, `effective_to` (nullable). No overlapping date ranges for the same consultant and project (exclusion constraint).

Rate lookup rule: the rate in effect on the work date is the row with the latest `effective_from` ≤ date (and, for assignments, `effective_to` null or ≥ date).

### 4.2 Time

- **timesheets**: `consultant_id`, `week_start` (Monday), `status` (`draft` | `submitted` | `approved` | `rejected`), `submitted_at`, `decided_by`, `decided_at`, `decision_comment`; unique (`consultant_id`, `week_start`)
- **time_entries**: `timesheet_id`, `project_id`, `work_date`, `hours`, `note`, `client_rate_snapshot`, `cost_rate_snapshot`, `invoice_line_id` (nullable)

Rules:
- Entry requires an assignment in effect on `work_date`; `work_date` within the timesheet week; hours > 0; total per consultant per day ≤ 24.
- Snapshots are written on approval and are what invoicing and P&L use.
- Approved entries are read-only. A Manager may reopen an approved timesheet only if none of its entries are invoiced.

### 4.3 Invoicing

- **invoice_templates**: `name`, `base_layout` (`classic` | `modern` | `compact`), `options` jsonb (accent colour, visible columns, payment terms text, footer text, show task notes), `is_default`
- **invoices**: `client_id`, `template_id`, `number` (null while draft), `subject`, `period_start`, `period_end`, `issue_date`, `due_date`, `status` (`draft` | `issued` | `partly_paid` | `paid` | `void`), `subtotal`, `tax_percent`, `tax_amount`, `total`, `amount_paid`, `pdf_path`, client billing snapshot fields, firm header snapshot fields
- **invoice_lines**: `invoice_id`, `consultant_id`, `project_id`, `description`, `hours`, `rate`, `amount`, `sort_order`

Invoice number pattern: any prefix is literal text typed into the pattern itself (there is no separate prefix setting or `{PREFIX}` token). Tokens: `{YYYY}`, `{YY}`, `{MM}`, `{SEQ:n}` (zero-padded to n digits). Example: `SRS-{YYYY}-{SEQ:4}` → `SRS-2026-0042`. The sequence is per firm, never resets in v1, and is incremented inside the issue transaction with a row lock on the firm. Numbers are unique per firm.

Snapshots: on issue, the client billing details and firm header are copied onto the invoice so later edits to client or firm do not change issued invoices.

### 4.4 Money in and out

- **payments**: `invoice_id`, `amount` (> 0), `paid_on`, `method` (`bank_transfer` | `check` | `card` | `cash` | `other`), `reference`, `notes`
- **expense_categories**: `name`, `active`; seeded per firm with common defaults (Travel, Software, Office, Contractors, Professional fees, Other)
- **expenses**: `spent_on`, `category_id`, `payee`, `amount`, `client_id` (nullable), `project_id` (nullable; if set, client is derived from it), `notes`
- **attachments**: `owner_type` (`payment` | `expense`), `owner_id`, `storage_path`, `file_name`, `mime_type`, `size_bytes`. Allowed types: PDF, PNG, JPEG, HEIC; max 10 MB each.

### 4.5 Audit

- **audit_log**: `actor_id`, `entity_type`, `entity_id`, `action`, `before` jsonb, `after` jsonb, `at`. Written by database triggers on invoices, payments, rate tables, and firm_members.

## 5. Workflows

### 5.1 Timesheet entry and approval
1. Consultant opens a week: a grid of their active assigned projects (rows) × days (columns); each cell holds hours and an optional note. Save as draft any time.
2. Submit → status `submitted`; entries become read-only to the consultant.
3. Manager reviews a queue of submitted timesheets; approve (snapshots rates) or reject with a comment (returns to `draft`-editable state with the comment visible).

### 5.2 Invoice creation
1. Manager selects client, period (start/end), and template.
2. App lists approved, uninvoiced entries for that client within the period, grouped by consultant × project; all consultants pre-selected; Manager can deselect consultants.
3. Draft lines are generated one per consultant × project × rate snapshot: summed hours, combined task notes as description (editable), rate, amount = round(hours × rate, 2). Subtotal, tax, total computed.
4. Manager edits subject, descriptions, issue/due dates, tax percent; may regenerate lines from selection while draft.
5. **Issue**: in one transaction — assign number, snapshot firm and client details, link entries to lines (locking them), set status `issued`. PDF rendered and stored after commit; if rendering fails the invoice stays issued and the PDF can be regenerated.
6. **Void** (issued invoices with no payments): status `void`, entries unlinked so they can be re-invoiced; number remains consumed. Drafts can be deleted outright.

### 5.3 Payment reconciliation (manual)
1. From an invoice or the Unpaid Invoices list, Manager records a payment and attaches one or more files.
2. `amount_paid` and status recompute: `partly_paid` if 0 < paid < total, `paid` if paid = total.
3. A payment that would make paid exceed total is rejected.
4. Deleting a payment recomputes status and is audit-logged.

### 5.4 Expenses
Manager enters an expense with optional client/project and attaches receipts. Expenses list filters by date, category, client, project.

### 5.5 P&L reporting
Filters: date range, client(s), project(s). Group by: month, quarter, client, or project.

Per group:
- **Revenue** = Σ approved entry hours × client_rate_snapshot, by `work_date`
- **Labour cost** = Σ same hours × cost_rate_snapshot
- **Gross profit** = Revenue − Labour cost
- **Direct expenses** = expenses tied to the group's client/project, by `spent_on`
- **Net profit** = Gross profit − Direct expenses; **Margin %** = Net / Revenue
- Side columns: **Invoiced** (issued, non-void invoice totals by issue date) and **Collected** (payments by `paid_on`)

Firm-level totals add an **Unallocated overhead** row for expenses with no client/project. Reports export to CSV.

## 6. Errors and validation

- All business rules are enforced on the server (Server Actions plus database constraints and RLS), not only in the UI.
- Users see short plain-language messages; stack traces and SQL errors go to server logs only.
- Uploads are validated by type and size before storage, and stored under random file names.

## 7. Testing

- **Unit (Vitest):** rate lookup by date, money rounding, invoice totals, number-pattern formatting, P&L aggregation.
- **Database (pgTAP or SQL tests against local Supabase):** RLS isolation — firm A user cannot read/write firm B in every table and storage; Consultant cannot read rate or invoice tables; last-Admin protection; invoice-number uniqueness under concurrent issue.
- **End-to-end (Playwright):** main flow of each phase.

## 8. Environments

- Local development with the Supabase CLI (local Postgres, Auth, Storage).
- One hosted Supabase project and a Vercel deployment; staging and production split when real firms are onboarded.

## 9. Build phases

Each phase gets its own implementation plan and ends with working, testable software.

1. **Foundation** — auth, platform-owner firm creation, invites, roles, firm settings and logo, consultants, vendors, clients, projects, cost and client rates, RLS baseline, audit log.
2. **Timesheets** — weekly grid, submit, approve/reject, reopen, rate snapshots.
3. **Invoicing** — templates, number pattern, invoice builder, issue, PDF, void.
4. **Payments** — record payments, attachments, status recompute, unpaid list.
5. **Expenses** — categories, expense entry, receipts.
6. **P&L** — report screen, grouping, filters, CSV export.

## 10. Out of scope for v1

Structured project task list; self-signup and subscription billing; bank feeds and automatic payment matching; emailing invoices; multiple currencies; consultant-submitted expenses; accounting exports (QuickBooks, Xero); multiple tax lines per invoice.
