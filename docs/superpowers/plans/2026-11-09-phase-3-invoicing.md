# Phase 3: Invoicing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers build a draft invoice for a client and period from approved, uninvoiced hours (plus optional manual lines and an optional invoice-level discount), issue it with a numbered, branded PDF from a chosen template, download it, and void it if needed; Admins manage the firm's invoice templates.

**Architecture:** Three new tables (`invoice_templates`, `invoices`, `invoice_lines`) plus a foreign key from `time_entries.invoice_line_id`. Templates are ordinary Admin-editable rows. Invoices and lines can only be written by `security definer` Postgres functions that lock rows, check roles and keep totals consistent; all money arithmetic happens in Postgres `numeric`. Issuing assigns the number under a row lock on the firm, snapshots firm and client details, and links each time entry to its line. The PDF is rendered on the server with `@react-pdf/renderer` from a pure view model, stored in the `firm-files` bucket, and can be regenerated if rendering fails.

**Tech Stack:** As Phases 1–2 (Next.js 15 App Router, React 19, Supabase Postgres 17 / Storage, Zod, Tailwind 4 + shadcn/ui, Vitest 3, Playwright) plus `@react-pdf/renderer` 4.x (server-only).

**Spec:** `docs/superpowers/specs/2026-11-08-consulting-ops-design.md` — sections 3.2 (invoices row), 4.3, 4.5 (audit on invoices), 5.2 (items 1–9), 7, 9 phase 3.

## Global Constraints

- Everything in Phase 1 and Phase 2 Global Constraints still holds: standard business columns + `set_updated_at()`, composite `(firm_id, x_id)` foreign keys with `unique (firm_id, id)`, RLS on every table, nothing readable by `anon`, `Result<T>` from data functions, user-facing errors only via `mapDbError`, every new SQL function `set search_path = ''` + fully qualified names + `revoke execute ... from public, anon` + explicit `grant execute ... to authenticated`.
- Money `numeric(12,2)`, `>= 0`. All money arithmetic (line amounts, subtotal, tax, total) happens in SQL; TypeScript only moves money as strings (`::text`) and formats it. Rounding: `round(x, 2)` (Postgres numeric rounds half away from zero).
- Line amount = `round(quantity × unit_price, 2)`. Subtotal = sum of line amounts. Discount amount = `round(subtotal × discount_value / 100, 2)` for a percentage, `least(discount_value, subtotal)` for a fixed amount, or 0. Tax amount = `round((subtotal − discount amount) × tax_percent / 100, 2)`. Total = subtotal − discount amount + tax amount.
- Discount types: `none | percent | amount` (enum `invoice_discount_type`). One discount per invoice; no negative lines.
- Invoice statuses: `draft | issued | partly_paid | paid | void` (enum `invoice_status`; Phase 4 uses the paid states). Layouts: `classic | modern | compact` (enum `invoice_layout`). Line kinds: `time | manual` (enum `invoice_line_kind`).
- Invoice and line rows are read by Admins and Managers only. Consultants see nothing from this phase.
- Templates are managed by Admins (create, edit, delete, set default); Managers can read them to pick one.
- Number pattern tokens: `{YYYY}`, `{YY}`, `{MM}` (from the issue date), `{SEQ:n}` (zero-padded to n digits; wider numbers are not truncated). Everything else in the pattern is literal. The sequence is per firm, never resets, and only `issue_invoice` advances it.
- PDF money is formatted with the currency **code**, not symbol (`Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code' })` → `USD 1,234.56`), because the built-in PDF fonts can't draw every currency symbol. PDFs use only the built-in Helvetica family (no network fonts).
- PDF storage path: `firms/{firm_id}/invoices/{invoice_id}/{random}.pdf`.
- Migration file names continue the sequence: `20261109000013_invoicing_schema.sql`, `20261109000014_invoice_drafts.sql`, `20261109000015_invoice_issue.sql`.
- After any migration: `npm run db:reset && npm run db:types`.
- E2E tests run against a production build with `workers: 1`; each test creates its own firm via `newFirm()`. Use distinctive money values (e.g. rate `133.33`) so assertions can't match by accident.

## Review Focus

1. **Hours change between building a draft and issuing it** (a timesheet is reopened and re-approved with different hours): issue fails with "Hours changed since this draft was built. Regenerate the lines, then issue." and nothing is numbered or linked. Test in Task 4.
2. **Two drafts covering the same hours:** the first issues; the second fails with the same stale-hours message and no number is consumed. Test in Task 4.
3. **Several invoices issued at the same moment:** each gets a distinct, consecutive number, and no number is skipped or duplicated. Test in Task 4.
4. **Awkward rounding** (7.33 h × 133.33 = 977.3089, tax 8.25%): line `977.31`, tax `80.63`, total `1057.94`, exactly. Test in Task 3.
5. **Discount larger than the subtotal** (a fixed 900 discount, then the hours lines are regenerated down to a 0 subtotal): setting a discount above the subtotal is refused with "The discount can't be more than the subtotal.", and after regeneration the discount is capped at the subtotal so the total is never negative. Test in Task 3.
6. **Client or firm details edited after issue:** the issued invoice (and a regenerated PDF) still shows the details as they were at issue. Test in Task 4 (data) and Task 6 (view model).

---

## File Structure

```
supabase/migrations/
  20261109000013_invoicing_schema.sql   # enums, templates (+ default seeding), invoices, lines, FK from time_entries, RLS, audit, format_invoice_number, set_default_template
  20261109000014_invoice_drafts.sql     # candidates, create/regenerate/update draft, manual lines, delete draft, recalc
  20261109000015_invoice_issue.sql      # issue_invoice, void_invoice, set_invoice_pdf
src/lib/
  domain/invoice-number.ts  domain/invoice-number.test.ts   # formatInvoiceNumber (mirror of SQL)
  domain/money.ts                                           # + formatMoneyCode
  db-errors.ts  db-errors.test.ts                           # + invoice messages
  db-types.ts                                               # + InvoiceStatus, InvoiceLayout, InvoiceLineKind
src/modules/
  invoice-templates/  schemas.ts  data.ts  actions.ts  schemas.test.ts
  invoices/           schemas.ts  data.ts  actions.ts
  invoices/pdf/       view-model.ts  view-model.test.ts  document.tsx  render.ts  render.test.ts  storage.ts
src/app/f/[firmId]/
  settings/templates/page.tsx  settings/templates/template-form.tsx
  invoices/page.tsx  invoices/new/page.tsx  invoices/new/builder-form.tsx
  invoices/[id]/page.tsx  invoices/[id]/draft-editor.tsx  invoices/[id]/issued-actions.tsx
  invoices/[id]/pdf/route.ts
tests/integration/
  invoice-fixtures.ts  invoicing-schema.test.ts  invoice-drafts.test.ts  invoice-issue.test.ts  invoices.test.ts
tests/e2e/invoices.spec.ts  tests/e2e/invoice-templates.spec.ts
```

---

### Task 1: Number formatting, money code formatting, template options, error messages

**Files:**
- Create: `src/lib/domain/invoice-number.ts`, `src/lib/domain/invoice-number.test.ts`, `src/modules/invoice-templates/schemas.ts`, `src/modules/invoice-templates/schemas.test.ts`
- Modify: `src/lib/domain/money.ts` (+ test), `src/lib/db-errors.ts`, `src/lib/db-errors.test.ts`

**Interfaces:**
- `formatInvoiceNumber(pattern: string, seq: number, issueDate: string): string` — `issueDate` is `YYYY-MM-DD`; replaces `{YYYY}`, `{YY}`, `{MM}`, `{SEQ:n}` (`String(seq).padStart(n, '0')`); all other characters literal. Assumes a pattern already valid per `validateInvoicePattern`.
- `formatMoneyCode(amount: string, currency: string): string` in `money.ts` — `Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code' })`, with the narrow no-break space Intl may emit replaced by a normal space.
- `src/modules/invoice-templates/schemas.ts`:
  - `TemplateOptions = { accentColor: string; showConsultant: boolean; showProject: boolean; showQuantity: boolean; showRate: boolean; showTaskNotes: boolean; showDailyDetail: boolean; paymentTermsText: string; footerText: string }`
  - `DEFAULT_TEMPLATE_OPTIONS: TemplateOptions` = `{ accentColor: '#1F2937', showConsultant: true, showProject: true, showQuantity: true, showRate: true, showTaskNotes: true, showDailyDetail: false, paymentTermsText: '', footerText: '' }`
  - `templateOptionsSchema` (Zod): `accentColor` matches `^#[0-9A-Fa-f]{6}$` (`'Use a colour like #1F2937.'`); text fields trimmed, max 500 (`'Keep this to 500 characters or fewer.'`); missing keys fall back to defaults.
  - `templateInputSchema`: `{ name (1–60, trimmed, 'Enter a template name.'), baseLayout: 'classic'|'modern'|'compact', options: templateOptionsSchema }`
  - `parseTemplateOptions(json: unknown): TemplateOptions` — tolerant reader for DB JSON (invalid or missing keys → defaults).
- `mapDbError` gains these rows:

| Needle | Message |
|---|---|
| `INVOICE_NOT_FOUND` | Invoice not found. |
| `INVOICE_STATE` | This invoice can't be changed in its current state. |
| `INVOICE_EMPTY` | Add at least one line before issuing. |
| `INVOICE_STALE` | Hours changed since this draft was built. Regenerate the lines, then issue. |
| `INVOICE_HAS_PAYMENTS` | This invoice has payments, so it can't be voided. |
| `LINE_NOT_MANUAL` | Only manual lines can be changed this way. |
| `TEMPLATE_IS_DEFAULT` | The default template can't be deleted. Make another template the default first. |
| `invoice_templates_firm_name_key` | That name is already in use. |
| `invoice_templates_accent_chk` | Use a colour like #1F2937. |
| `invoices_template_fk` | This template is used by invoices, so it can't be deleted. |
| `invoices_period_chk` | The period end must be on or after the period start. |
| `invoices_due_chk` | The due date must be on or after the issue date. |
| `invoices_tax_chk` | Tax must be between 0 and 100 percent. |
| `invoice_lines_quantity_chk` | Quantity must be more than 0. |
| `invoice_lines_description_chk` | Enter a description. |
| `DISCOUNT_TOO_LARGE` | The discount can't be more than the subtotal. |
| `invoices_discount_chk` | A percentage discount must be between 0 and 100, and an amount can't be negative. |

- [ ] **Step 1: Write failing tests:**
  - `formatInvoiceNumber('SRS-{YYYY}-{SEQ:4}', 42, '2026-11-09')` → `'SRS-2026-0042'`; `('INV{YY}{MM}-{SEQ:3}', 7, '2027-01-31')` → `'INV2701-007'`; `('{SEQ:2}', 1234, '2026-11-09')` → `'1234'`; `('A/{YYYY}/{SEQ:1}', 5, '2026-03-01')` → `'A/2026/5'`.
  - `formatMoneyCode('1234.5', 'USD')` → `'USD 1,234.50'`; `formatMoneyCode('0', 'EUR')` → `'EUR 0.00'`.
  - `templateOptionsSchema`: `{}` → `DEFAULT_TEMPLATE_OPTIONS`; `accentColor: 'red'` → error message above; 501-char footer → error. `parseTemplateOptions({ accentColor: 'bad', showRate: false })` → defaults with `showRate: false` and default colour.
  - `mapDbError` returns each new message for a matching error (extend the table-driven test).
- [ ] **Step 2:** Run `npm run test:unit` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run test:unit` → PASS; `npm run lint && npm run typecheck` clean.
- [ ] **Step 5: Commit** `feat(domain): invoice number formatting, template options, invoice error messages`

---

### Task 2: Invoicing schema, templates and number function

**Files:**
- Create: `supabase/migrations/20261109000013_invoicing_schema.sql`, `tests/integration/invoice-fixtures.ts`, `tests/integration/invoicing-schema.test.ts`
- Modify: `src/lib/db-types.ts`, `src/lib/supabase/types.ts` (regenerated)

**Interfaces:**
- Enums: `invoice_status`, `invoice_layout`, `invoice_line_kind`, `invoice_discount_type` (values in Global Constraints).
- `public.invoice_templates`: standard columns + `name text not null` (trimmed non-empty), `base_layout invoice_layout not null default 'classic'`, `options jsonb not null default '{}'`, `is_default boolean not null default false`. Constraints: `invoice_templates_firm_id_id_key unique (firm_id, id)`; unique index `invoice_templates_firm_name_key on (firm_id, lower(name))`; partial unique index `invoice_templates_one_default on (firm_id) where is_default`; `invoice_templates_accent_chk check (options->>'accentColor' is null or options->>'accentColor' ~ '^#[0-9A-Fa-f]{6}$')`.
  - Grants: select, insert, update, delete to authenticated. RLS: select `has_role(firm_id,'{admin,manager}')`; insert/update/delete `has_role(firm_id,'{admin}')`.
  - Trigger `invoice_templates_guard_default` (before delete): raise `TEMPLATE_IS_DEFAULT` when deleting the default row.
  - Trigger on `firms` after insert (`firms_seed_invoice_template`, security definer): inserts `('Standard', 'classic', '{}', true)` for the new firm. The migration also inserts the same row for every existing firm that has no template.
  - `public.set_default_template(p_template uuid) returns void` (security definer): admin of the template's firm only (`42501`); clears `is_default` on the firm's other templates and sets it on this one, in one statement order that never violates the partial unique index.
- `public.invoices`: standard columns + `client_id uuid not null`, `template_id uuid not null`, `number text`, `subject text`, `period_start date not null`, `period_end date not null`, `issue_date date not null`, `due_date date not null`, `status invoice_status not null default 'draft'`, `currency text not null`, `subtotal numeric(12,2) not null default 0`, `discount_type invoice_discount_type not null default 'none'`, `discount_value numeric(12,2) not null default 0`, `discount_label text`, `discount_amount numeric(12,2) not null default 0`, `tax_percent numeric(5,2) not null default 0`, `tax_amount numeric(12,2) not null default 0`, `total numeric(12,2) not null default 0`, `amount_paid numeric(12,2) not null default 0`, `pdf_path text`, snapshot columns `bill_to_name, bill_to_contact_name, bill_to_email, bill_to_phone, bill_to_address, from_name, from_address, from_contact_name, from_contact_email, from_contact_phone, from_logo_path` (all `text`), `issued_at timestamptz`, `issued_by uuid references profiles(user_id) on delete set null`, `voided_at timestamptz`, `voided_by uuid references profiles(user_id) on delete set null`.
  - Constraints: `invoices_firm_id_id_key unique (firm_id, id)`; `invoices_client_fk (firm_id, client_id) → clients on delete restrict`; `invoices_template_fk (firm_id, template_id) → invoice_templates on delete restrict`; `invoices_period_chk check (period_end >= period_start)`; `invoices_due_chk check (due_date >= issue_date)`; `invoices_tax_chk check (tax_percent between 0 and 100)`; `invoices_money_chk check (subtotal >= 0 and tax_amount >= 0 and total >= 0 and amount_paid >= 0 and discount_amount >= 0 and discount_amount <= subtotal)`; `invoices_discount_chk check ((discount_type = 'none' and discount_value = 0) or (discount_type = 'percent' and discount_value between 0 and 100) or (discount_type = 'amount' and discount_value >= 0))`; `invoices_number_chk check ((status = 'draft') = (number is null))`; unique index `invoices_firm_number_key on (firm_id, number) where number is not null`; `invoices_pdf_path_chk check (pdf_path is null or pdf_path like 'firms/' || firm_id::text || '/invoices/' || id::text || '/%')`. Indexes `(firm_id, status, issue_date)`, `(firm_id, client_id)`.
- `public.invoice_lines`: standard columns + `invoice_id uuid not null`, `kind invoice_line_kind not null`, `consultant_id uuid`, `project_id uuid`, `description text not null`, `quantity numeric(9,2) not null`, `unit_price numeric(12,2) not null`, `amount numeric(12,2) not null`, `sort_order integer not null default 0`.
  - Constraints: `invoice_lines_firm_id_id_key unique (firm_id, id)`; `invoice_lines_invoice_fk (firm_id, invoice_id) → invoices on delete cascade`; `(firm_id, consultant_id) → consultants on delete restrict`; `(firm_id, project_id) → projects on delete restrict`; `invoice_lines_kind_chk check ((kind = 'time') = (consultant_id is not null and project_id is not null))`; `invoice_lines_quantity_chk check (quantity > 0)`; `invoice_lines_money_chk check (unit_price >= 0 and amount >= 0)`; `invoice_lines_description_chk check (length(btrim(description)) > 0)`. Index `(firm_id, invoice_id, sort_order)`.
- `time_entries`: add `time_entries_invoice_line_fk foreign key (firm_id, invoice_line_id) references invoice_lines (firm_id, id) on delete set null (invoice_line_id)`; index `(firm_id, invoice_line_id) where invoice_line_id is not null`.
- `invoices` and `invoice_lines`: `revoke all ... from anon, authenticated; grant select ... to authenticated`; RLS select `has_role(firm_id,'{admin,manager}')`. No write grants (Tasks 3–4 functions write).
- Audit: `invoices_audit` and `invoice_templates_audit` triggers with `public.audit_row()`.
- `public.format_invoice_number(p_pattern text, p_seq integer, p_issue date) returns text` (immutable, `set search_path = ''`): same behaviour as `formatInvoiceNumber`. Granted to authenticated.
- `tests/integration/invoice-fixtures.ts`:
  - `seedApprovedHours(f, opts: { clientName?: string; projectName?: string; consultantName?: string; clientRate?: string; costRate?: string; weekStart?: string; entries: { workDate: string; hours: string; note?: string }[] }): Promise<{ clientId: string; projectId: string; consultantId: string; timesheetId: string }>` — creates client, project, consultant (linked to `f.consultant`), cost rate, assignment, then saves, submits (consultant) and approves (manager) the week via the Phase 2 RPCs. Defaults: client rate `'133.33'`, cost `'80'`, week `'2026-10-05'`.
  - Reuses `newFirm` from `helpers.ts`.
- `db-types.ts` adds `InvoiceStatus`, `InvoiceLayout`, `InvoiceLineKind`, `InvoiceDiscountType`.

- [ ] **Step 1: Write failing tests** in `invoicing-schema.test.ts`:
  - `new firm gets a default Standard template`: after `newFirm()`, admin selects `invoice_templates` → one row, `name 'Standard'`, `base_layout 'classic'`, `is_default true`.
  - `admin manages templates; manager reads only`: admin inserts "Modern" → ok; manager insert → RLS error; manager select → 2 rows; consultant select → 0 rows.
  - `one default per firm`: `set_default_template(modern)` → Modern default, Standard not; manager calling it → `42501`.
  - `default template can't be deleted`: delete Standard after it's no longer default → ok; delete the current default → error contains `TEMPLATE_IS_DEFAULT`.
  - `bad accent colour rejected`: options `{ "accentColor": "red" }` → `invoice_templates_accent_chk`.
  - `invoices and lines are read-only to clients`: manager `insert` into `invoices` → error; consultant select on `invoices`/`invoice_lines` → 0 rows; firm B admin select → 0 rows of firm A (insert a firm-A invoice via `adminDb` for these checks).
  - `number format matches TypeScript`: for the four Task 1 cases, `rpc('format_invoice_number', …)` equals `formatInvoiceNumber(…)`.
  - `invoice number unique per firm`: two `adminDb` inserts with the same number in one firm → `invoices_firm_number_key` error; same number in two firms → ok.
  - `time entry FK`: setting `time_entries.invoice_line_id` (via `adminDb`) to a random uuid → FK error.
- [ ] **Step 2:** Run `npm run test:int -- invoicing-schema` → FAIL.
- [ ] **Step 3:** Write the migration, fixtures and type aliases.
- [ ] **Step 4:** `npm run db:reset && npm run db:types`; `npm run test:int` → all PASS.
- [ ] **Step 5: Commit** `feat(db): invoicing schema, templates with default, invoice number formatting`

---

### Task 3: Draft invoices

**Files:**
- Create: `supabase/migrations/20261109000014_invoice_drafts.sql`, `tests/integration/invoice-drafts.test.ts`
- Modify: `src/lib/supabase/types.ts` (regenerated)

**Interfaces** (all `security definer`; every function on an existing invoice locks it `for update`, raises `INVOICE_NOT_FOUND` if missing, then requires `has_role(firm,'{admin,manager}')` (`42501`), then `status = 'draft'` (`INVOICE_STATE`) unless noted):
- `public.invoice_candidates(p_firm uuid, p_client uuid, p_start date, p_end date) returns table (consultant_id uuid, consultant_name text, project_id uuid, project_name text, rate text, hours text, entry_count integer)` (stable) — approved entries (`timesheets.status = 'approved'`) with `invoice_line_id is null`, on projects of `p_client`, `work_date between p_start and p_end`, grouped by consultant × project × `client_rate_snapshot`; ordered by consultant name, project name, rate. Managers only.
- `public.create_invoice_draft(p_firm uuid, p_client uuid, p_start date, p_end date, p_template uuid, p_consultants uuid[]) returns uuid` — managers only; inserts a draft with `currency` = firm currency, `tax_percent` = firm `default_tax_percent`, `issue_date = current_date`, `due_date = current_date + default_payment_terms_days`; then generates time lines (as below) for consultants in `p_consultants` (null = all); recalculates totals. A draft with zero lines is allowed (manual-only invoice).
- Time-line generation (internal helper `public.invoice_generate_time_lines(p_invoice uuid, p_consultants uuid[])`, not granted to anyone): deletes the invoice's `time` lines, then inserts one line per candidate group: `quantity` = summed hours, `unit_price` = rate, `amount = round(quantity * unit_price, 2)`, `description` = distinct non-empty task notes in date order joined with `'; '`, cut to 500 characters, or the project name when there are none; `sort_order` 1.. in candidate order. Manual lines keep their `sort_order` after the time lines (renumber manual lines to follow).
- `public.regenerate_invoice_lines(p_invoice uuid, p_consultants uuid[]) returns void` — reruns generation with the invoice's own client and period; manual lines are kept.
- `public.update_invoice_draft(p_invoice uuid, p_subject text, p_issue_date date, p_due_date date, p_tax_percent numeric, p_template uuid) returns void` — updates those fields (template must be in the same firm — composite FK enforces), recalculates totals.
- `public.update_invoice_period(p_invoice uuid, p_start date, p_end date, p_consultants uuid[]) returns void` — changes the period, then regenerates time lines.
- `public.set_invoice_line_description(p_line uuid, p_description text) returns void` — any line kind on a draft.
- `public.save_manual_line(p_invoice uuid, p_line uuid, p_description text, p_quantity numeric, p_unit_price numeric) returns uuid` — `p_line` null inserts (sort_order after all lines); otherwise updates that line, which must be `manual` (`LINE_NOT_MANUAL`) and belong to `p_invoice`; amount recomputed; totals recalculated.
- `public.delete_manual_line(p_line uuid) returns void` — manual only (`LINE_NOT_MANUAL`); totals recalculated.
- `public.set_invoice_discount(p_invoice uuid, p_type invoice_discount_type, p_value numeric, p_label text) returns void` — sets the discount (`none` forces value 0 and label null; label trimmed, empty → null, max 60 characters); for `amount`, raises `DISCOUNT_TOO_LARGE` when `p_value` exceeds the current subtotal; recalculates totals.
- `public.delete_invoice_draft(p_invoice uuid) returns void` — draft only; deletes it (lines cascade).
- Internal `public.invoice_recalc(p_invoice uuid)` (not granted): `subtotal = coalesce(sum(amount),0)`; `discount_amount` per Global Constraints (a fixed amount is capped at the subtotal here, never an error); `tax_amount = round((subtotal - discount_amount) * tax_percent / 100, 2)`; `total = subtotal - discount_amount + tax_amount`.
- Drafts never touch `time_entries.invoice_line_id` (linking happens at issue).

- [ ] **Step 1: Write failing tests** (use `seedApprovedHours`):
  - `candidates`: approved week with Mon 8h note "Discovery" and Tue 7.5h note "Workshop" → one row, hours `'15.50'`, rate `'133.33'`, entry_count 2; a submitted-but-not-approved week → not included; entries outside the period → not included; another client's hours → not included; consultant user calling it → `42501`.
  - `rate change mid-period gives two lines`: change client rate from Wed (Phase 2 `change_client_rate`) before approval → `create_invoice_draft` produces two time lines with rates `133.33` and the new rate.
  - `line description from notes`: description `'Discovery; Workshop'`; with no notes → project name.
  - `rounding (Review Focus 4)`: one entry of 7.33h at rate 133.33 and firm `default_tax_percent` 8.25 (set via `adminDb` before creating the draft) → line amount `'977.31'`, subtotal `'977.31'`, tax `'80.63'`, total `'1057.94'` (read as `::text`).
  - `percentage discount`: same 977.31 subtotal and 8.25% tax; `set_invoice_discount(id, 'percent', 10, 'Loyalty')` → discount `'97.73'`, tax `'72.57'`, total `'952.15'`.
  - `fixed discount`: `set_invoice_discount(id, 'amount', 100, null)` → discount `'100.00'`, tax `'72.38'`, total `'949.69'`; then `'none'` → discount `'0.00'`, total `'1057.94'` again.
  - `discount too large (Review Focus 5)`: subtotal 977.31, fixed 1000 → `DISCOUNT_TOO_LARGE`; fixed 900, then `regenerate_invoice_lines(id, '{}')` (no consultants, subtotal 0) → `discount_amount '0.00'`, total `'0.00'`; percent 101 → `invoices_discount_chk`.
  - `deselecting a consultant`: two consultants with hours; `regenerate_invoice_lines(id, [c1])` → only c1's lines; manual line still present after regeneration and sorted after time lines.
  - `manual lines`: add "Setup fee" qty 1 × 500 → total includes 500.00; edit to qty 2 → 1000.00; `save_manual_line` targeting a time line → `LINE_NOT_MANUAL`; delete manual line → totals drop.
  - `header edits`: `update_invoice_draft` with due before issue → `invoices_due_chk`; tax 101 → `invoices_tax_chk`; tax 10 → totals recalculated.
  - `period change regenerates`: shrink period to exclude Tue → hours `'8.00'`.
  - `consultant can't touch drafts`: consultant calling `create_invoice_draft` / `save_manual_line` → `42501`; firm B manager on firm A invoice → error, unchanged.
  - `delete draft`: removes invoice and its lines; time entries untouched.
- [ ] **Step 2:** Run `npm run test:int -- invoice-drafts` → FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `npm run db:reset && npm run db:types`; `npm run test:int` → all PASS.
- [ ] **Step 5: Commit** `feat(db): draft invoices from approved hours, manual lines, totals`

---

### Task 4: Issue and void

**Files:**
- Create: `supabase/migrations/20261109000015_invoice_issue.sql`, `tests/integration/invoice-issue.test.ts`
- Modify: `src/lib/supabase/types.ts` (regenerated)

**Interfaces** (security definer; same lock / not-found / role order as Task 3):
- `public.issue_invoice(p_invoice uuid) returns text` — draft only; `INVOICE_EMPTY` when it has no lines. Then:
  1. Lock the firm row (`select ... from firms where id = v_firm for update`).
  2. For every `time` line, find the entries it stands for: approved, `invoice_line_id is null`, consultant = line consultant, project = line project, `client_rate_snapshot = unit_price`, `work_date` within the invoice period, project belongs to the invoice client. If any line's matching hours sum ≠ its `quantity`, raise `INVOICE_STALE`. Link the matching entries (`invoice_line_id = line.id`).
  3. Number = `format_invoice_number(firm.invoice_number_pattern, firm.invoice_next_seq, invoice.issue_date)`; increment `invoice_next_seq`.
  4. Snapshot `bill_to_*` from the client (`bill_to_name` = client name, `bill_to_contact_name` = billing contact, `bill_to_email`, `bill_to_phone`, `bill_to_address`) and `from_*` from the firm (name, address, contact name/email/phone, `logo_path`), and `currency` from the firm.
  5. Set `status 'issued'`, `number`, `issued_at = now()`, `issued_by = auth.uid()`. Return the number.
  Any raise rolls everything back (nothing linked, no number consumed).
- `public.void_invoice(p_invoice uuid) returns void` — status `issued` only (`INVOICE_STATE` otherwise); `INVOICE_HAS_PAYMENTS` when `amount_paid > 0`; unlinks its entries (`invoice_line_id = null`), sets `status 'void'`, `voided_at`, `voided_by`. The number stays on the invoice and the sequence is not rewound.
- `public.set_invoice_pdf(p_invoice uuid, p_path text) returns void` — managers; status `issued`, `partly_paid` or `paid`; sets `pdf_path` (the `invoices_pdf_path_chk` constraint enforces the folder).
- Phase 2's `reopen_timesheet` already refuses (`TIMESHEET_INVOICED`) while any entry is linked; after void it works again.

- [ ] **Step 1: Write failing tests:**
  - `issue`: firm pattern `SRS-{YYYY}-{SEQ:4}`, `invoice_next_seq` 41 (set via `adminDb`), issue date `2026-11-09` → returns `'SRS-2026-0041'`; firm `invoice_next_seq` now 42; status `issued`; both entries linked to the line; `bill_to_name` and `from_name` populated; `issued_by` = manager.
  - `empty`: manual-free, line-free draft → `INVOICE_EMPTY`; seq unchanged.
  - `stale (Review Focus 1)`: build draft; reopen the timesheet, consultant edits Mon to 6h, resubmits, manager re-approves; issue → `INVOICE_STALE`; nothing linked; seq unchanged; after `regenerate_invoice_lines` issue succeeds.
  - `double claim (Review Focus 2)`: two drafts for the same client/period → first issues; second → `INVOICE_STALE`; seq advanced by exactly 1.
  - `concurrent issue (Review Focus 3)`: five drafts each with a manual line, issued via `Promise.all` from the manager client → five distinct numbers forming a consecutive run; seq advanced by 5.
  - `snapshot (Review Focus 6)`: after issue, update the client's billing address and the firm's name via `adminDb` → invoice `bill_to_address` / `from_name` unchanged.
  - `issued is locked`: `save_manual_line`, `update_invoice_draft`, `delete_invoice_draft` on an issued invoice → `INVOICE_STATE`.
  - `reopen blocked while invoiced`: `reopen_timesheet` → `TIMESHEET_INVOICED`.
  - `void`: void → status `void`, entries unlinked, number kept; a new draft for the same period picks the hours up again and issues with the next number (`…0042`); `reopen_timesheet` on the original week now succeeds (use a separate fixture for this so the re-invoice test stays valid).
  - `void with payments`: set `amount_paid = 10` via `adminDb`; void → `INVOICE_HAS_PAYMENTS`.
  - `void a draft`: → `INVOICE_STATE`.
  - `set_invoice_pdf`: path outside `firms/{firm}/invoices/{id}/` → `invoices_pdf_path_chk`; correct path → saved; on a draft → `INVOICE_STATE`.
  - `consultant and other firm`: consultant `issue_invoice` → `42501`; firm B manager → error; firm A state unchanged.
- [ ] **Step 2:** Run `npm run test:int -- invoice-issue` → FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `npm run db:reset && npm run db:types`; `npm run test:int` → all PASS.
- [ ] **Step 5: Commit** `feat(db): issue invoices with numbering, snapshots and entry linking; void`

---

### Task 5: Templates and invoices data modules

**Files:**
- Create: `src/modules/invoice-templates/data.ts`, `actions.ts`; `src/modules/invoices/schemas.ts`, `data.ts`, `actions.ts`
- Test: `tests/integration/invoices.test.ts`

**Interfaces:**
- `invoice-templates/data.ts` (all `(db, firmId, …)` → `Result`):
  - `TemplateRow = { id: string; name: string; baseLayout: InvoiceLayout; options: TemplateOptions; isDefault: boolean }`
  - `listTemplates(db, firmId)`, `getTemplate(db, firmId, id)`, `createTemplate(db, firmId, input: TemplateInput)` → `{ id }`, `updateTemplate(db, firmId, id, input)`, `deleteTemplate(db, firmId, id)`, `setDefaultTemplate(db, firmId, id)`. `options` read through `parseTemplateOptions`.
- `invoice-templates/actions.ts`: `createTemplateAction`, `updateTemplateAction`, `deleteTemplateAction`, `setDefaultTemplateAction` — `requireFirmRole(firmId, ['admin'])`; form fields `name`, `baseLayout`, `accentColor`, the six `show*` checkboxes (`'on'` → true), `paymentTermsText`, `footerText`; revalidate `/f/{firmId}/settings/templates`.
- `invoices/data.ts`:
  - `InvoiceListRow = { id; number: string | null; clientName: string; periodStart; periodEnd; issueDate; dueDate; status: InvoiceStatus; total: string; currency: string }`
  - `InvoiceLine = { id; kind: InvoiceLineKind; consultantId: string | null; consultantName: string | null; projectId: string | null; projectName: string | null; description: string; quantity: string; unitPrice: string; amount: string; sortOrder: number }`
  - `InvoiceDetail = InvoiceListRow & { clientId; templateId; subject: string | null; taxPercent: string; subtotal: string; discountType: InvoiceDiscountType; discountValue: string; discountLabel: string | null; discountAmount: string; taxAmount: string; amountPaid: string; pdfPath: string | null; billTo: { name; contactName; email; phone; address } | null; from: { name; address; contactName; contactEmail; contactPhone; logoPath } | null; lines: InvoiceLine[]; consultantIds: string[] }` — `billTo`/`from` null while draft; `consultantIds` = consultants on current time lines.
  - `Candidate = { consultantId; consultantName; projectId; projectName; rate: string; hours: string; entryCount: number }`
  - `listInvoices(db, firmId, opts?: { status?: InvoiceStatus })` — newest first (drafts first, then by issue date desc)
  - `getInvoice(db, firmId, id)`, `listCandidates(db, firmId, clientId, start, end)`
  - `createDraft(db, firmId, input: { clientId; periodStart; periodEnd; templateId; consultantIds: string[] | null })` → `{ id }`
  - `regenerateLines(db, firmId, id, consultantIds: string[] | null)`, `updateDraftHeader(db, firmId, id, input: { subject: string | null; issueDate; dueDate; taxPercent: string; templateId })`, `updatePeriod(db, firmId, id, input: { periodStart; periodEnd; consultantIds: string[] | null })`, `setLineDescription(db, firmId, lineId, description)`, `saveManualLine(db, firmId, invoiceId, input: { lineId: string | null; description; quantity: string; unitPrice: string })`, `deleteManualLine(db, firmId, lineId)`, `setDiscount(db, firmId, id, input: { type: InvoiceDiscountType; value: string; label: string | null })`, `deleteDraft(db, firmId, id)`, `issueInvoice(db, firmId, id)` → `{ number: string }`, `voidInvoice(db, firmId, id)`, `setInvoicePdf(db, firmId, id, path)`.
  - Money and quantities selected as `::text`.
- `invoices/schemas.ts` (Zod): builder input (client required `'Choose a client.'`, ISO dates, end ≥ start `'The period end must be on or after the period start.'`, template required); header input (tax via `parseMoney`-style 0–100 with ≤2 dp `'Tax must be between 0 and 100 percent.'`, due ≥ issue); manual line (description 1–500, quantity > 0 with ≤ 2 dp `'Enter a quantity above 0.'`, unit price via `parseMoney`); discount (`type` none/percent/amount; percent 0–100 with ≤ 2 dp `'Enter a percentage between 0 and 100.'`; amount via `parseMoney`; label ≤ 60 characters).
- `invoices/actions.ts`: one action per data function, `requireFirmRole(firmId, ['admin','manager'])`, form parsing via the schemas, revalidating `/f/{firmId}/invoices` and `/f/{firmId}/invoices/{id}`. `createDraftAction` redirects to the new invoice page on success. `issueInvoiceAction` issues, then calls `generateAndStorePdf` (Task 6) and returns `{ ok: true, data: { number, pdfError: string | null } }` — a PDF failure never undoes the issue; `pdfError` is `'Invoice issued, but the PDF couldn't be created. Use Regenerate PDF.'`. Until Task 6 lands, import `generateAndStorePdf` from `src/modules/invoices/pdf/storage.ts` as a stub that returns `fail('PDF rendering is not set up yet.')`; Task 6 replaces it.

- [ ] **Step 1: Write failing integration tests** in `invoices.test.ts`: templates CRUD + default switch via data functions (admin), manager `createTemplate` → permission message; `listCandidates` → one row with hours `'15.50'`; `createDraft` → `getInvoice` has 1 time line + totals as strings; `saveManualLine` → 2 lines; `setDiscount` percent 10 → `getInvoice` shows `discountAmount` and the recalculated total as strings; `issueInvoice` → `{ number }` and `getInvoice` status `issued` with `billTo.name`; `voidInvoice` → status `void`; `listInvoices({ status: 'void' })` → that invoice; data errors come back as mapped messages (e.g. issue an empty draft → `'Add at least one line before issuing.'`).
- [ ] **Step 2:** Run `npm run test:int -- invoices.test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `npm run typecheck && npm run lint` clean.
- [ ] **Step 5: Commit** `feat(invoices): templates and invoices data modules and actions`

---

### Task 6: PDF rendering and storage

**Files:**
- Create: `src/modules/invoices/pdf/view-model.ts`, `view-model.test.ts`, `document.tsx`, `render.ts`, `render.test.ts`, `storage.ts` (replace the Task 5 stub), `src/app/f/[firmId]/invoices/[id]/pdf/route.ts`
- Modify: `package.json` (+ `@react-pdf/renderer`), `next.config.ts` (`serverExternalPackages: ['@react-pdf/renderer']`)

**Interfaces:**
- `view-model.ts` (pure):
  - `FirmHeader = { name: string; address: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null }` and `ClientBilling = { name: string; contactName: string | null; email: string | null; phone: string | null; address: string | null }` — live details, used only for draft previews.
  - `InvoiceDocumentData = { title: 'Invoice' | 'Draft invoice'; number: string | null; issueDate: string; dueDate: string; period: string; subject: string | null; from: { name; addressLines: string[]; contactLines: string[]; logo: { data: Uint8Array; format: 'png' | 'jpg' } | null }; billTo: { name; addressLines: string[]; contactLines: string[] }; columns: { consultant: boolean; project: boolean; quantity: boolean; rate: boolean }; lines: { consultant: string; project: string; description: string; quantity: string; rate: string; amount: string }[]; totals: { subtotal: string; discountLabel: string | null; discount: string | null; taxLabel: string; tax: string; total: string }; paymentTerms: string; footer: string; layout: InvoiceLayout; accentColor: string; detail: { date: string; consultant: string; project: string; hours: string; note: string }[] | null }`
  - `buildInvoiceDocument(input: { invoice: InvoiceDetail; template: TemplateRow; firm: FirmHeader; client: ClientBilling; logo: InvoiceDocumentData['from']['logo']; detailEntries: { workDate; consultantName; projectName; hours; note }[] }): InvoiceDocumentData` — uses the invoice's own `from`/`billTo` snapshots when issued and the live firm/client details for a draft preview; money via `formatMoneyCode(…, invoice.currency)`; `taxLabel` = `Tax (8.25%)`; when `discountAmount > 0`, `discountLabel` = the label or `Discount`, plus ` (10%)` for a percentage, and `discount` = `-` + the formatted amount (e.g. `-USD 97.73`), otherwise both null; description omits task notes when `showTaskNotes` is false (time lines then show the project name); `detail` is null unless `showDailyDetail`; `paymentTerms` = template text, or `Payment due by {due date}.` when empty; dates formatted `9 Nov 2026`.
- `document.tsx`: `InvoiceDocument({ data }: { data: InvoiceDocumentData })` — React-PDF `<Document>`; page 1 header (logo, from block, title, number/dates/period, bill-to), subject, lines table with the enabled columns, totals (with a discount row when present), payment terms, footer; when `detail` is set, a second page "Hours detail" table. Layouts: `classic` (white header, accent rule), `modern` (accent-coloured header band, white text), `compact` (smaller type and spacing). Built-in Helvetica only.
- `render.ts`: `renderInvoicePdf(data: InvoiceDocumentData): Promise<Uint8Array>` (`renderToBuffer`). File starts with `import 'server-only'`.
- `storage.ts`:
  - `loadInvoiceDocument(db, firmId, invoiceId): Promise<Result<InvoiceDocumentData>>` — gathers invoice, template, firm/client details, logo bytes (download `from_logo_path` / firm `logo_path` from `firm-files`; missing or failed logo → `null`, never an error), and detail entries (issued: entries linked to its lines; draft: current candidate entries for its time lines).
  - `generateAndStorePdf(db, firmId, invoiceId): Promise<Result<{ path: string }>>` — renders, uploads to `firms/{firmId}/invoices/{invoiceId}/{randomUUID}.pdf` (`contentType: 'application/pdf'`), then `setInvoicePdf`.
  - `readStoredPdf(db, path): Promise<Result<Uint8Array>>`.
- `route.ts` `GET /f/{firmId}/invoices/{id}/pdf` — `requireFirmRole(firmId, ['admin','manager'])`; issued/paid/void with `pdf_path` → stream the stored file; draft → render a preview on the fly (not stored); issued without a PDF → 404 with text `No PDF yet. Use Regenerate PDF.` Headers: `Content-Type: application/pdf`, `Content-Disposition: inline; filename="{number or 'draft-invoice'}.pdf"`, `Cache-Control: private, no-store`.
- Add `regeneratePdfAction(firmId, invoiceId)` to `invoices/actions.ts` (issued/paid statuses only).

- [ ] **Step 1: Write failing tests:**
  - `view-model.test.ts`: issued invoice uses snapshots even when live firm/client values differ (Review Focus 6); `showRate: false` → `columns.rate` false; `showTaskNotes: false` → time-line description is the project name; `showDailyDetail: true` → `detail` rows in date order; money `'USD 977.31'`; empty payment terms → `'Payment due by 9 Dec 2026.'`; a 10% `Loyalty` discount → `discountLabel 'Loyalty (10%)'`, `discount '-USD 97.73'`; no discount → both null; draft → title `'Draft invoice'`, `number` null.
  - `render.test.ts`: each layout renders a buffer starting with `%PDF-`; with `detail` set, the buffer is larger than without (sanity check that the second page rendered).
  - Integration (append to `invoices.test.ts`): `generateAndStorePdf` on an issued invoice → `pdf_path` set under `firms/{firmId}/invoices/{id}/` and `readStoredPdf` returns bytes starting with `%PDF-`; with an injected failing renderer the issue action's data path still leaves the invoice `issued` and `pdf_path` null (expose an optional `render` parameter on `generateAndStorePdf` for this test).
- [ ] **Step 2:** Run unit + `npm run test:int -- invoices.test` → FAIL.
- [ ] **Step 3:** `npm install @react-pdf/renderer`; implement.
- [ ] **Step 4:** Run → PASS; `npm run build` succeeds; lint/typecheck clean.
- [ ] **Step 5: Commit** `feat(invoices): PDF rendering with three layouts, storage and download route`

---

### Task 7: Template settings page

**Files:**
- Create: `src/app/f/[firmId]/settings/templates/page.tsx`, `template-form.tsx`
- Modify: `src/app/f/[firmId]/settings/page.tsx` (link `Invoice templates` → `/settings/templates`)
- Test: `tests/e2e/invoice-templates.spec.ts`

**Interfaces:**
- Admin only (`requireFirmRole(firmId, ['admin'])`; others 404).
- Page lists templates (name, layout, `Default` badge) with `Edit`, `Make default` (not on the default), `Delete` (not on the default; confirm). `New template` opens the form; `?edit={id}` opens it for that template.
- Form fields with labels: `Name`, `Layout` (select Classic / Modern / Compact), `Accent colour` (text `#RRGGBB` plus a colour swatch), checkboxes `Show consultant`, `Show project`, `Show quantity`, `Show rate`, `Show task notes`, `Add hours detail page`, textareas `Payment terms`, `Footer`. Field errors under fields; action errors in `role="alert"`.
- `Preview` link per template is not required (previews come from drafts in Task 8).

- [ ] **Step 1: Write failing e2e tests:** admin opens Settings → `Invoice templates` → sees `Standard` marked `Default`; creates "Modern blue" (Modern, `#1D4ED8`, hours detail on) → listed; `Make default` → it shows `Default`; deleting it is not offered while default; making Standard default again then deleting "Modern blue" → gone; accent `blue` → `Use a colour like #1F2937.`; a manager visiting the page → 404.
- [ ] **Step 2:** Run `npm run test:e2e -- invoice-templates` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(invoices): invoice template settings`

---

### Task 8: Invoice list, builder, draft editor and issued view

**Files:**
- Create: `src/app/f/[firmId]/invoices/page.tsx`, `invoices/new/page.tsx`, `invoices/new/builder-form.tsx`, `invoices/[id]/page.tsx`, `invoices/[id]/draft-editor.tsx`, `invoices/[id]/issued-actions.tsx`
- Modify: `src/app/f/[firmId]/layout.tsx` (nav `Invoices` → `/invoices`, admin/manager, after `Timesheets`)
- Test: `tests/e2e/invoices.spec.ts`

**Interfaces:**
- `/invoices` (admin/manager): status filter links (All, Draft, Issued, Void — plus Partly paid / Paid once Phase 4 exists; show all five now), table: Number (or `Draft`), Client, Period, Issue date, Due date, Total (`formatMoney` with firm currency), Status; row links to `/invoices/{id}`; `New invoice` button; empty state `"No invoices yet."`
- `/invoices/new`: form `Client` (active clients), `Period start`, `Period end` (default: first and last day of the previous month), `Template` (default selected). `Find hours` (GET with query params) shows the candidate table (consultant, project, rate, hours) with a checkbox per consultant (`Include {consultant name}`, all checked) and `Create draft`. No candidates → `"No approved, uninvoiced hours for this client in that period."` with `Create draft` still available (for manual-only invoices).
- `/invoices/{id}` draft view (`draft-editor.tsx`): header form (`Subject`, `Issue date`, `Due date`, `Tax %`, `Template`) with `Save details`; period form (`Period start`, `Period end`) + consultant checkboxes + `Regenerate lines`; lines table (consultant, project, description editable per line with `Save` on change, quantity, rate, amount); manual line form (`Description`, `Quantity`, `Unit price`, `Add line`) and per-manual-line `Edit` / `Remove`; discount form (`Discount` select: No discount / Percentage / Fixed amount, `Discount value`, `Discount label`, `Save discount`); totals (Subtotal, Discount when present, Tax, Total); `Preview PDF` (opens the pdf route in a new tab); `Issue invoice` (confirm dialog: `Issue this invoice? It gets the next number and can't be edited afterwards.`); `Delete draft` (confirm).
- Issued/void view: read-only header with number and status, bill-to and from (snapshots), lines, totals; `Download PDF` (the pdf route); `Regenerate PDF` when `pdf_path` is null; `Void invoice` (issued only, confirm `Void this invoice? Its hours become available to invoice again. The number won't be reused.`); a `pdfError` from issuing shows in a `role="alert"` box.
- All money shown with `formatMoney(amount, currency)`.

- [ ] **Step 1: Write failing e2e tests** (seed with `seedApprovedHours`, rate `133.33`, entries Mon 8h "Discovery", Tue 7.5h "Workshop"; firm pattern `ACME-{YYYY}-{SEQ:4}`):
  - `manager builds, edits and issues an invoice`: `Invoices` → `New invoice` → client, period covering the week → `Find hours` → candidate row shows `15.50` → `Create draft` → draft shows line amount `2,066.62` and description `Discovery; Workshop` → add manual line `Setup fee` 1 × `250` → total `2,316.62` (tax 0) → set a `Percentage` discount of `10` labelled `Loyalty` → totals show discount `231.66` and total `2,084.96` → `Issue invoice` → confirm → page shows number `ACME-{current year}-0001` and status `Issued` → `Download PDF` response has `content-type` `application/pdf` (use `page.request.get`).
  - `issued invoice is locked`: no `Add line`, `Save details` or `Delete draft` controls.
  - `void returns hours`: void the issued invoice → status `Void`; `New invoice` for the same period → candidate row `15.50` is back.
  - `preview a draft`: `Preview PDF` link responds `200` with `application/pdf`.
  - `consultant gets 404 on /invoices`.
- [ ] **Step 2:** Run `npm run test:e2e -- invoices` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(invoices): invoice list, builder, draft editor and issued view`

---

### Task 9: README and full gate

**Files:**
- Modify: `README.md`
- Test: full suite

**Interfaces:**
- README "Invoicing" section: who can do what; the optional discount (percentage or fixed amount, taken off before tax); templates (Admin, one default, three layouts, hours detail page); building an invoice from approved, uninvoiced hours in a period, plus manual lines; number pattern tokens and that the sequence never resets or rewinds; issue snapshots firm and client details; PDFs stored in Storage and regenerable; voiding returns hours to the pool and keeps the number; consultants never see invoices.

- [ ] **Step 1:** Write the README section.
- [ ] **Step 2:** Run the full gate after `npm run db:reset`: `npm run lint && npm run typecheck && npm run test:unit && npm run test:int && npm run test:e2e` → all PASS.
- [ ] **Step 3: Commit** `docs: invoicing`
