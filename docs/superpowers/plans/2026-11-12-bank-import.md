# Bank Statement Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Firms upload OFX/QFX or CSV statements per bank/card account, review each line, and turn it into an invoice payment, expense, other income, a link to an existing entry, or ignore it, with no duplicates.

**Architecture:** Parsing runs in TypeScript on the server (`src/modules/bank/`); lines are stored through one security-definer import function with a per-account unique dedupe key. Every review action is a single security-definer SQL function that locks the line, creates or links the record and marks the line in one transaction. Pages follow the existing Billing pages (server components + small client forms + server actions returning `Result`).

**Tech Stack:** Next.js 15 App Router, React 19, Supabase Postgres (RLS, `search_path ''` definer functions), Tailwind 4, Vitest (unit + integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-bank-import-design.md`

## Global Constraints

- Admin/manager only: every function starts with `if not public.has_role(<firm>, '{admin,manager}'::public.firm_role[]) then raise exception 'permission denied' using errcode = '42501'`; `revoke execute ... from public, anon; grant ... to authenticated`.
- Every table: `firm_id`, RLS enabled, composite `(firm_id, id)` uniqueness and composite FKs, as in `20261109000021_expenses.sql`.
- Amounts `numeric(12,2)`; bank_lines.amount signed and ≠ 0; amounts travel as text in TS.
- Limits: file ≤ 5 MB, ≤ 5,000 lines; account name 1–60 chars, unique per firm (case-insensitive, trimmed); last4 exactly 4 digits or null; source 1–120; ignore_reason ≤ 200; notes ≤ 1000; payment reference ≤ 120 (cut the description to 120).
- Seeded other income categories, in order: Interest, Refund, Owner contribution, Other.
- Payment method from bank line: `bank_transfer` for `bank` accounts, `card` for `credit_card`.
- "Already entered" window: ±7 days, same absolute amount, not linked by any bank line.
- User-facing messages are plain sentences, mapped in `src/lib/db-errors.ts` (e.g. `LINE_HANDLED` → "This line was already handled. The page has been refreshed.").
- Migrations: `20261112000030_bank_schema.sql`, `20261112000031_bank_functions.sql`, `20261112000032_other_income_report.sql`.
- Menu (Billing): Invoices, Unpaid invoices, Payments, Expenses, Other income, Bank accounts.

## Review Focus

1. Re-uploading an overlapping CSV (same rows plus new ones) must add only the new rows, including when two identical rows exist in both files. Pinned in Task 3 and Task 4 tests.
2. Credit-card CSVs that show purchases as positive: "flip signs" must make them money out, and OFX card files (negative purchases) must not be flipped. Pinned in Task 3.
3. Two people confirming the same line at once: the second gets LINE_HANDLED and no second payment or expense is created. Pinned in Task 4.
4. A part payment larger than the invoice's balance due, or an invoice voided after it was suggested, must fail with the existing payment error and leave the line New. Pinned in Task 4.
5. A description containing `=HYPERLINK(...)` or `<script>` must be stored verbatim, rendered escaped, and formula-guarded in the Transactions CSV. Pinned in Task 3 (clean) and Task 7 (CSV).

---

### Task 1: Schema (accounts, imports, lines, other income)

**Files:**
- Create: `supabase/migrations/20261112000030_bank_schema.sql`
- Test: `tests/integration/bank-schema.test.ts`

**Interfaces:**
- Produces tables:
  - `bank_accounts(id, firm_id, name, kind bank_account_kind ('bank'|'credit_card'), last4, csv_mapping jsonb, active, created_at, created_by, updated_at)`
  - `bank_imports(id, firm_id, account_id, file_name, format ('ofx'|'csv'), line_count int, duplicate_count int, imported_at, imported_by)`
  - `bank_lines(id, firm_id, account_id, import_id, posted_on date, amount numeric(12,2), description text, clean_description text, bank_ref text, dedupe_key text, status bank_line_status ('new'|'done'|'ignored'), ignore_reason, payment_id, expense_id, other_income_id, created_at, updated_at)`
  - `other_income_categories` (the same shape, trim trigger, unique-name index, policies and seed trigger as expense_categories)
  - `other_income(id, firm_id, received_on, category_id, source, amount > 0, notes, created_at, created_by, updated_at)`
- bank_lines rules:
  - unique `(account_id, dedupe_key)`
  - check that at most one of payment_id/expense_id/other_income_id is set
  - check `(status='done') = (num_nonnulls(payment_id, expense_id, other_income_id) = 1)`
  - check `(status='ignored') or ignore_reason is null`
  - partial unique indexes on each link column `where ... is not null`
  - the link FKs are composite with `on delete set null (payment_id)` etc. (Postgres 15+ column list)
  - `before update` trigger: if status = 'done' and no link remains, set status = 'new'
- RLS:
  - accounts, other_income and other_income_categories: select/insert/update/delete for admin/manager
  - bank_imports and bank_lines: select only (writes go through Task 4 functions)
- other_income gets a rules trigger mirroring `expenses_apply_rules`: trim the source and notes, `INCOME_FUTURE` for a future date, `CATEGORY_RETIRED` for an inactive category. Also the updated_at and audit triggers.

- [ ] **Step 1: Write failing integration tests** in `bank-schema.test.ts`:
  - a new firm has the 4 other income categories, in order
  - a consultant and another firm's manager read 0 rows from every new table
  - a manager can insert, rename and deactivate an account; a duplicate name (different case) fails
  - a direct insert into bank_lines from a manager fails (RLS)
  - deleting a payment that a done line links to (line set up by service role) leaves the line `new` with no link
  - other_income with a future date is rejected
- [ ] **Step 2: Run** `npx vitest run --project integration tests/integration/bank-schema.test.ts` and expect it to FAIL (relations missing).
- [ ] **Step 3: Write the migration**, then run `npx supabase migration up`.
- [ ] **Step 4: Run the tests again** and expect them to PASS. Then run `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(bank): schema for bank accounts, lines and other income`

### Task 2: Error messages and types

**Files:**
- Modify: `src/lib/db-errors.ts` (add mappings)
- Modify: `src/lib/supabase/types.ts` (regenerate with `npx supabase gen types typescript --local > src/lib/supabase/types.ts`, keeping the existing file header if any)

**Interfaces:**
- Produces message mappings:
  - `LINE_HANDLED`: "This line was already handled. The page has been refreshed."
  - `LINE_DIRECTION`: "That action doesn't fit the direction of this line."
  - `LINK_MISMATCH`: "The amounts don't match."
  - `ALREADY_LINKED`: "That entry is already matched to another bank line."
  - `ACCOUNT_INACTIVE`: "This account is inactive."
  - `INCOME_FUTURE`: "The date can't be in the future."
  - the unique-name constraint: "An account with that name already exists."

- [ ] **Step 1:** Add the mappings and regenerate the types.
- [ ] **Step 2: Run** `npm run typecheck` and expect PASS.
- [ ] **Step 3: Commit** `chore(bank): error messages and generated types` (this can fold into Task 4's commit if done together)

### Task 3: Parsers, cleaning and dedupe keys (pure TS)

**Files:**
- Create: `src/modules/bank/ofx.ts`, `src/modules/bank/csv.ts`, `src/modules/bank/clean.ts`, `src/modules/bank/dedupe.ts`, `src/modules/bank/types.ts`
- Test: `src/modules/bank/parse.test.ts`
- Fixtures: `tests/fixtures/bank/sample-sgml.qfx`, `sample-xml.ofx`, `card-positive.csv`, `inout.csv`

**Interfaces:**
- `type ParsedLine = { postedOn: string /* YYYY-MM-DD */; amount: string /* signed, 2dp */; description: string; bankRef: string | null }`
- `type ParseResult = { lines: ParsedLine[]; errors: { row: number; reason: string }[] }`
- `parseOfx(text: string): Result<ParseResult>`: handles SGML (unclosed tags) and XML; reads STMTTRN DTPOSTED (first 8 digits), TRNAMT, FITID, NAME + MEMO joined with " – " when both are present and different
- `type CsvMapping = { dateColumn: number; dateFormat: 'YMD' | 'MDY' | 'DMY'; descriptionColumn: number; amount: { mode: 'signed'; column: number; flip: boolean } | { mode: 'inout'; inColumn: number; outColumn: number } }`
- `readCsv(text: string): string[][]`: RFC 4180 (quotes, doubled quotes, CRLF/LF, BOM stripped)
- `parseCsv(text: string, mapping: CsvMapping): Result<ParseResult>`: the header row is skipped; bad rows go in `errors` with the 1-based file row number
- `cleanDescription(s: string): string`: collapse whitespace, strip card-terminal noise (trailing `#1234`, `*AB12CD`, dates like `11/04`), upper-case, max 80 chars
- `dedupeKeys(lines: ParsedLine[]): string[]`: `fitid:<ref>` when bankRef is set; otherwise `h:` + sha256(`date|amount|cleanDescription|n`), where n is the occurrence number of that tuple within the file
- Limits enforced by `parseStatement(fileName: string, text: string, mapping: CsvMapping | null): Result<ParseResult & { format: 'ofx' | 'csv' }>`:
  - format comes from the extension (.ofx/.qfx → ofx, .csv → csv)
  - more than 5,000 lines → fail "This file has more than 5,000 transactions. Split it and upload the parts."
  - zero lines and zero errors → fail "No transactions found in this file."

- [ ] **Step 1: Write failing tests:**
  - an SGML QFX with 3 transactions parses dates, signs and FITIDs
  - XML OFX gives the same result
  - CSV signed + flip turns `+45.00` purchases into `-45.00`
  - CSV in/out columns: an empty or "0.00" side is ignored and amounts like `"1,234.50"` and `$12.00` parse
  - the three date formats work, and `13/25/2026` under MDY is a row error
  - quoted commas and newlines inside a field are read correctly
  - a zero amount is a row error
  - dedupe: two identical rows give two different keys, and parsing the same file twice gives the same keys
  - an overlapping file reproduces the keys of shared rows
  - cleanDescription examples: `"AMZN Mktp US*2K4LL9 "` → `"AMZN MKTP US"`, and `"=HYPERLINK(1)"` is kept as text, upper-cased
  - the 5,001-line limit message
- [ ] **Step 2: Run** `npx vitest run --project unit src/modules/bank` and expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** and expect PASS. Then run `npm run lint`.
- [ ] **Step 5: Commit** `feat(bank): OFX/QFX and CSV statement parsing`

### Task 4: Import and review functions (SQL)

**Files:**
- Create: `supabase/migrations/20261112000031_bank_functions.sql`
- Test: `tests/integration/bank-functions.test.ts`, with helpers in `tests/integration/bank-fixtures.ts`

**Interfaces:** all are security definer and check has_role on the line's or account's firm. Any line function on a line whose status ≠ the expected one raises `LINE_HANDLED`, and the line is locked with `select ... for update`.
- `import_bank_lines(p_account uuid, p_file_name text, p_format text, p_lines jsonb) returns table(import_id uuid, inserted int, duplicates int)`
  - p_lines is an array of `{posted_on, amount, description, clean_description, bank_ref, dedupe_key}`
  - raises `ACCOUNT_INACTIVE` for an inactive account
  - inserts with `on conflict (account_id, dedupe_key) do nothing`
  - writes the bank_imports row with the counts
- `save_csv_mapping(p_account uuid, p_mapping jsonb) returns void`
- `confirm_bank_line_payment(p_line uuid, p_invoice uuid, p_notes text) returns uuid`
  - amount must be > 0, otherwise `LINE_DIRECTION`
  - calls `public.record_payment(p_invoice, amount, posted_on, <method by account kind>, coalesce(bank_ref, left(description,120)), p_notes)`
  - sets payment_id and status 'done'
- `confirm_bank_line_expense(p_line uuid, p_payee text, p_category uuid, p_client uuid, p_project uuid, p_notes text) returns uuid`
  - amount must be < 0
  - inserts the expense with amount = -amount and spent_on = posted_on
- `confirm_bank_line_other_income(p_line uuid, p_category uuid, p_source text, p_notes text) returns uuid`: amount must be > 0
- `link_bank_line(p_line uuid, p_payment uuid, p_expense uuid) returns void`
  - exactly one argument must be non-null
  - a payment needs amount = line amount; an expense needs amount = -line amount; otherwise `LINK_MISMATCH`
  - the entry must be in the same firm; if another line already links it, raise `ALREADY_LINKED`
- `ignore_bank_lines(p_lines uuid[], p_reason text) returns int`: only `new` lines change; returns the count changed
- `reset_bank_line(p_line uuid) returns void`: done/ignored → new; clears the links and reason; never deletes the record
- `list_bank_lines(p_account uuid, p_status text) returns table(...)`
  - columns: line fields + linked record summary (invoice number / payee / source) + `suggested_category_id`
  - suggested_category_id is the category of the most recent done expense line in the same firm with the same clean_description
  - new lines oldest first; done/ignored newest first; limit 500
- `bank_match_candidates(p_line uuid) returns jsonb` with three lists:
  - `{invoices: [{id, number, client_name, balance_due}], payments: [{id, paid_on, amount, invoice_number, client_name}], expenses: [{id, spent_on, amount, payee}]}`
  - invoices: open (issued/partly_paid), only for money in
  - payments/expenses: in the ±7-day window, matching the absolute amount and direction, not linked by any line

- [ ] **Step 1: Write failing integration tests:**
  - importing the same payload twice gives `inserted 3 / duplicates 0` and then `0 / 3`
  - an inactive account is refused
  - confirming a payment creates the payment (method `card` on a card account) and marks the line done
  - confirming the same line again gives LINE_HANDLED, and only one payment exists
  - two concurrent confirms (`Promise.all`) give exactly one success
  - a money-out line can't become a payment (LINE_DIRECTION)
  - a part payment over the balance gives the record_payment error and the line stays new
  - confirming an expense uses the right sign and date, and a retired category is refused
  - other income is confirmed
  - link: a mismatched amount gives LINK_MISMATCH, and linking twice gives ALREADY_LINKED
  - ignore then reset gives back `new`
  - candidates: an invoice with an equal balance is listed and a voided invoice isn't; the ±7-day window works at the edges (day 7 in, day 8 out); linked payments are excluded
  - `suggested_category_id` follows the last confirmed expense with the same clean_description
  - a consultant gets 42501 from every function
- [ ] **Step 2: Run** `npx vitest run --project integration tests/integration/bank-functions.test.ts` and expect FAIL.
- [ ] **Step 3: Write the migration**, then run `npx supabase migration up`.
- [ ] **Step 4: Run the tests** and expect PASS.
- [ ] **Step 5: Commit** `feat(bank): import and review functions`

### Task 5: Bank data module, suggestions and actions

**Files:**
- Create: `src/modules/bank/data.ts`, `src/modules/bank/suggest.ts`, `src/modules/bank/schemas.ts`, `src/modules/bank/actions.ts`
- Test: `src/modules/bank/suggest.test.ts`, `src/modules/bank/schemas.test.ts`

**Interfaces:**
- data.ts (all `Promise<Result<…>>`):
  - `listAccounts(db, firmId)`: each account with its count of `new` lines
  - `getAccount(db, firmId, id)`
  - `createAccount` / `updateAccount(db, firmId, input: AccountInput)`
  - `importStatement(db, firmId, accountId, fileName, text, mapping)`: calls parseStatement → dedupeKeys → `import_bank_lines`; returns `{inserted, duplicates, errors}`
  - `saveCsvMapping`
  - `listLines(db, firmId, accountId, status)`
  - `getCandidates(db, firmId, lineId)`
  - `confirmPayment`, `confirmExpense`, `confirmOtherIncome`, `linkLine`, `ignoreLines`, `resetLine`
- `rankInvoices(description: string, invoices: {id; number; client_name; balance_due}[], amount: string)`:
  - exact balance and client name found in the description (case-insensitive, word-based) come first
  - then exact balance only
  - then the rest, ordered by number
- schemas.ts (zod):
  - `accountSchema`: name, kind, last4
  - `csvMappingSchema`: matching `CsvMapping`, with column indexes ≥ 0 and different from each other
  - `expenseConfirmSchema`, `otherIncomeConfirmSchema`, `paymentConfirmSchema`: notes ≤ 1000, payee 1–200, source 1–120
- actions.ts: server actions taking `(firmId, …)` and returning `Result`, which call `revalidatePath(`/f/${firmId}/bank/...`)`
  - upload reads `File` from FormData, refuses files over 5 MB ("This file is larger than 5 MB.") and reads the text as UTF-8

- [ ] **Step 1: Write failing unit tests** for rankInvoices (the three tiers, ties broken by number) and the schemas (duplicate CSV columns rejected, last4 must be 4 digits).
- [ ] **Step 2: Run** `npx vitest run --project unit src/modules/bank` and expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** and expect PASS. Then run `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `feat(bank): data module, suggestions and actions`

### Task 6: Bank pages and menu

**Files:**
- Create:
  - `src/app/f/[firmId]/bank/page.tsx`: list of accounts with the count of lines to review, plus "Add account"
  - `src/app/f/[firmId]/bank/new/page.tsx` and `src/app/f/[firmId]/bank/account-form.tsx`
  - `src/app/f/[firmId]/bank/[accountId]/page.tsx`: header with Edit / Deactivate; the upload form; the status tabs New / Done / Ignored
  - `src/app/f/[firmId]/bank/[accountId]/upload-form.tsx`: file input; when the account has no mapping and the file is CSV, shows `csv-mapping.tsx` with a 5-row preview, then imports. Afterwards it shows "N new lines, M already imported" and lists the row errors
  - `src/app/f/[firmId]/bank/[accountId]/review-list.tsx`: one row per line (date, description, signed amount); expanding a row shows the actions for its direction; checkboxes for bulk "Ignore" and "Confirm suggested" (money-out lines with a suggested category)
  - `src/app/f/[firmId]/bank/[accountId]/line-actions.tsx`: the Invoice payment / Other income / Expense / Already entered / Ignore panels; candidates load through a server action when a row opens
- Modify: `src/app/f/[firmId]/layout.tsx`: add "Other income" (`/other-income`) and "Bank accounts" (`/bank`) to Billing, for MANAGERS
- Test: `tests/e2e/bank.spec.ts`, using fixtures from Task 3

**Interfaces:**
- Consumes the Task 5 actions and data.
- Confirm on a destructive or bulk action uses `askConfirm` from `src/components/confirm-dialog.tsx`.
- File input uses the global teal `::file-selector-button` style (no extra classes).

- [ ] **Step 1: Write the failing e2e test** `bank.spec.ts`:
  - a manager adds account "Main checking" (Bank) and uploads `sample-sgml.qfx` → sees "3 new lines, 0 already imported"
  - confirms the deposit against the suggested invoice → the invoice's status shows Partly paid or Paid
  - confirms an expense with a category → it appears on Billing › Expenses
  - ignores the third line with the reason "Transfer"
  - uploads the same file again → "0 new lines, 3 already imported"
  - adds a card account, uploads `card-positive.csv`, maps the columns with flip on → the lines show as money out
  - a consultant gets 404 on `/bank`
- [ ] **Step 2:** Make sure port 3000 is free, then run `npx playwright test tests/e2e/bank.spec.ts`. Expect FAIL.
- [ ] **Step 3: Implement** the pages.
- [ ] **Step 4: Run the test** and expect PASS. Then run `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `feat(bank): bank accounts, upload and review pages`

### Task 7: Other income page and Transactions report

**Files:**
- Create: `supabase/migrations/20261112000032_other_income_report.sql`. This does `create or replace function public.transactions_report(...)`, adding a third union branch: kind `'other_income'`, `received_on`, `payee` = source, category = the other income category name; it is included when p_kind is in ('all', 'in').
- Create: `src/modules/other-income/data.ts`, `schemas.ts`, `actions.ts`
- Create: `src/app/f/[firmId]/other-income/page.tsx` (list with date filter, total, and add/edit/delete inline or on `[id]`), and `src/app/f/[firmId]/other-income/categories/page.tsx`, copying the expense categories page
- Modify: `src/modules/reports/transactions.ts`
  - `TxnRow.kind` adds `'other_income'`
  - describeTxn gives `Other income – <source>`
  - totals count other income as money in
- Modify: `src/modules/reports/transactions.test.ts`, `tests/integration` (add a case to a new `tests/integration/transactions-report.test.ts`)

- [ ] **Step 1: Write failing tests:**
  - unit: other income gets a positive sign, the right description, and counts in moneyIn
  - CSV: a guarded formula in the source
  - integration: transactions_report returns other income for 'all' and 'in' but not 'out'; another firm's manager gets 42501
  - e2e: add a step to `bank.spec.ts` that confirms a deposit as Other income (Interest), then checks it appears on Reports › Transactions with category Interest
- [ ] **Step 2: Run** the tests and expect FAIL.
- [ ] **Step 3: Implement**, then run `npx supabase migration up`.
- [ ] **Step 4: Run** the unit, integration and e2e files touched. Expect PASS.
- [ ] **Step 5: Commit** `feat(bank): other income and Transactions report rows`

### Task 8: Demo data and full verification

**Files:**
- Modify: `scripts/seed-demo.mjs`: add a "Main checking" bank account and an "Amex" card account to Demo Consulting, with a few `new` lines. One should be a deposit equal to an open invoice's balance and one an AWS charge that matches a past expense's payee, so the suggestions show up.

- [ ] **Step 1:** Update the seed and run it against the local DB.
- [ ] **Step 2: Run** `npm run lint && npm run typecheck && npm run test:unit && npm run test:int && npm run test:e2e` (port 3000 free). Expect everything to PASS.
- [ ] **Step 3: Commit** `chore(demo): bank accounts and lines in demo data`
