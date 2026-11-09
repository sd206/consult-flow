# Phase 4: Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers record payments against issued invoices with proof attached, invoices move to partly paid or paid automatically, payments can be corrected or deleted with a full audit trail, and an Unpaid Invoices page shows what's owed with overdue flags and ageing totals.

**Architecture:** Two new tables: `payments`, and a reusable `attachments` table that Phase 5's expenses will share. As with invoices, browsers can only read them; all writes go through `security definer` functions that lock the invoice row, so payments can't race each other past the invoice total, and each function recomputes `amount_paid` and status. Files are validated on the server by type, size and file signature, then stored under random names in the `firm-files` bucket. They are served through an auth-checked download route.

**Tech Stack:** As Phases 1–3 (Next.js 15, React 19, Supabase Postgres 17 / Storage, Zod, Tailwind 4 + shadcn/ui, Vitest 3, Playwright). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-08-consulting-ops-design.md`, sections 3.2 (payments row), 4.4 (payments, attachments), 4.5 (audit on payments), 5.3 (items 1–6), 6 (uploads), 7, and 9 (phase 4).

## Global Constraints

- Everything in Phases 1–3 Global Constraints still holds: standard business columns + `set_updated_at()`, composite `(firm_id, x_id)` FKs with `unique (firm_id, id)`, RLS on every table, nothing readable by `anon`, `Result<T>` data functions, errors only via `mapDbError`, every new SQL function `set search_path = ''` + fully qualified names + `revoke execute ... from public, anon` + explicit grant to `authenticated`, and money `numeric(12,2)` handled in SQL and moved as `::text` strings.
- Payment methods: `bank_transfer | check | card | cash | other` (enum `payment_method`). Labels: Bank transfer, Check, Card, Cash, Other.
- Payment amount > 0. A payment may not make `amount_paid` exceed the invoice `total`. Payment date may not be in the future (`paid_on <= current_date`).
- Invoice status after any payment change: `issued` when `amount_paid = 0`, `partly_paid` when `0 < amount_paid < total`, `paid` when `amount_paid = total`. Payments may be recorded only on `issued` or `partly_paid` invoices. Edits and deletes are also allowed on `paid` invoices. Void and draft invoices take no payment changes.
- Payment amount is never edited. Only `paid_on`, `method`, `reference`, `notes` and attachments can change.
- Admins and Managers record, edit and delete payments. Consultants see nothing from this phase.
- Attachments: PDF, PNG, JPEG, HEIC only (MIME `application/pdf`, `image/png`, `image/jpeg`, `image/heic`/`image/heif`), max 10 MB (10,485,760 bytes) each, max 5 files per upload. The type is verified by file signature, not just name or MIME. Stored at `firms/{firm_id}/attachments/payments/{payment_id}/{random uuid}.{ext}`. The original file name is kept in the database for display only.
- Server Actions must accept uploads up to 5 × 10 MB: set `experimental.serverActions.bodySizeLimit: '55mb'` in `next.config.ts`.
- Ageing uses days overdue = `current_date - due_date` (UTC). Buckets: `current` (≤ 0, not yet due), `d1_30`, `d31_60`, `d61_90`, `d90_plus` (> 90). Totals are sums of balance due (`total - amount_paid`), not invoice totals.
- Migration file names: `20261109000018_payments.sql`, `20261109000019_receivables.sql`.
- After any migration: `npm run db:reset && npm run db:types`.
- E2E tests run against a production build with `workers: 1`; each test creates its own firm; use distinctive amounts.

## Review Focus

1. **Overpayment, including two at once:** with 1,000.00 due, recording 600 and 600 at the same moment gives exactly one success, and the other fails with "This payment is more than the balance due." `amount_paid` ends at 600.00. Test in Task 2.
2. **Deleting a payment from a paid invoice:** the status goes back to partly paid (or issued), its files are removed from storage, and the audit log keeps the deleted payment's full row. Test in Tasks 2 and 3.
3. **A disguised or oversized file** (an `.exe` renamed `.pdf` with MIME `application/pdf`, or a 12 MB PDF): refused with a plain message, and nothing is stored. Test in Tasks 1 and 3.
4. **Voiding after payments:** refused while any payment exists, and allowed again once every payment is deleted. Test in Task 2.
5. **Ageing boundaries:** due today counts as not yet due; 1 and 30 days overdue go to 1–30; 31 to 31–60; 90 to 61–90; 91 to over 90. A partly paid invoice counts its balance, not its total. Test in Task 4.

---

## File Structure

```
supabase/migrations/20261109000018_payments.sql   # enum, payments, attachments, functions, reports
src/lib/
  domain/attachments.ts  domain/attachments.test.ts   # validateAttachment (signature sniffing), safe extension
  domain/ageing.ts       domain/ageing.test.ts        # overdueLabel, bucket labels
  db-errors.ts  db-errors.test.ts                     # + payment messages
  db-types.ts                                         # + PaymentMethod
src/modules/payments/   schemas.ts  data.ts  actions.ts  storage.ts
src/modules/receivables/ data.ts                      # unpaid list + ageing
src/app/f/[firmId]/
  invoices/[id]/payments-section.tsx                  # list, record, edit, delete (issued/partly_paid/paid)
  invoices/unpaid/page.tsx
  attachments/[id]/route.ts                           # auth-checked file download
tests/integration/ payments-db.test.ts  payments.test.ts  receivables.test.ts
tests/e2e/payments.spec.ts
```

---

### Task 1: Attachment validation, ageing labels, error messages

**Files:**
- Create: `src/lib/domain/attachments.ts`, `attachments.test.ts`, `src/lib/domain/ageing.ts`, `ageing.test.ts`
- Modify: `src/lib/db-errors.ts`, `src/lib/db-errors.test.ts`

**Interfaces:**
- `attachments.ts`:
  - `MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024`, `MAX_FILES_PER_UPLOAD = 5`
  - `AttachmentKind = 'pdf' | 'png' | 'jpeg' | 'heic'`
  - `validateAttachment(file: { name: string; type: string; size: number; bytes: Uint8Array }): Result<{ kind: AttachmentKind; ext: 'pdf' | 'png' | 'jpg' | 'heic'; mime: string }>`. It checks size (> 0 and ≤ max, else `'Each file must be 10 MB or smaller.'`; an empty file gets `'That file is empty.'`). Then it checks the file signature. Kind and MIME come from the signature, and the declared type and extension are ignored. Anything else gets `'Only PDF, PNG, JPEG or HEIC files can be attached.'`. Signatures:
    - **PDF:** bytes 0–4 `%PDF-`
    - **PNG:** `89 50 4E 47 0D 0A 1A 0A`
    - **JPEG:** `FF D8 FF`
    - **HEIC:** bytes 4–7 `ftyp` and brand at 8–11 in `heic, heix, hevc, hevx, mif1, msf1`; MIME `image/heic`
  - `displayFileName(name: string): string`: strips path parts and control characters, cuts to 120 characters, and falls back to `'file'` when empty.
- `ageing.ts`:
  - `AgeBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'`
  - `AGE_BUCKET_LABELS: Record<AgeBucket, string>` = `Not yet due`, `1–30 days`, `31–60 days`, `61–90 days`, `Over 90 days`
  - `bucketFor(daysOverdue: number): AgeBucket` (≤ 0 → current; 1–30; 31–60; 61–90; > 90)
  - `overdueLabel(daysOverdue: number): string | null`: `null` when ≤ 0, `'Overdue by 1 day'`, `'Overdue by N days'`
- `mapDbError` gains:

| Needle | Message |
|---|---|
| `PAYMENT_NOT_FOUND` | Payment not found. |
| `PAYMENT_TOO_LARGE` | This payment is more than the balance due. |
| `PAYMENT_NOT_ALLOWED` | Payments can only be recorded on issued invoices that aren't fully paid. |
| `PAYMENT_LOCKED` | Payments on this invoice can't be changed. |
| `PAYMENT_FUTURE` | The payment date can't be in the future. |
| `payments_amount_chk` | Enter an amount above 0. |
| `ATTACHMENT_NOT_FOUND` | File not found. |
| `attachments_path_chk` | That file doesn't belong here. |

- [ ] **Step 1: Write failing unit tests:**
  - `validateAttachment`:
    - Accepted: real minimal headers for each kind (build byte arrays in the test) → ok, with the right `kind`, `ext` and `mime`.
    - Declared type mismatch: a PNG named `scan.pdf` with type `application/pdf` → ok with kind `png`, because the signature wins.
    - Disguised file: `MZ` bytes named `invoice.pdf` with type `application/pdf` → the type message.
    - Size limits: 0 bytes → `'That file is empty.'`; 10,485,761 bytes → the size message; exactly 10,485,760 bytes with a PDF header → ok.
  - `displayFileName('../../etc/pass\u0000wd.pdf')` → `'pass wd.pdf'`, or with no control character. Assert no `/`, `\` or control characters remain.
  - `bucketFor`: −5 → current; 0 → current; 1 → d1_30; 30 → d1_30; 31 → d31_60; 60 → d31_60; 61 → d61_90; 90 → d61_90; 91 → d90_plus.
  - `overdueLabel`: 0 → null; 1 → `'Overdue by 1 day'`; 45 → `'Overdue by 45 days'`.
  - `mapDbError` gets one test row per new message.
- [ ] **Step 2:** Run `npm run test:unit` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run test:unit` passes; lint and typecheck are clean.
- [ ] **Step 5: Commit** `feat(domain): attachment validation, ageing buckets, payment error messages`

---

### Task 2: Payments and attachments in the database

**Files:**
- Create: `supabase/migrations/20261109000018_payments.sql`, `tests/integration/payments-db.test.ts`
- Modify: `src/lib/db-types.ts` (`PaymentMethod`), `src/lib/supabase/types.ts` (regenerated)

**Interfaces:**
- **Enum:** `public.payment_method`.
- **`public.payments` table:** standard columns plus `invoice_id uuid not null`, `amount numeric(12,2) not null`, `paid_on date not null`, `method payment_method not null`, `reference text`, `notes text`.
  - Constraints:
    - `payments_firm_id_id_key unique (firm_id, id)`
    - `payments_invoice_fk (firm_id, invoice_id) → invoices on delete restrict`
    - `payments_amount_chk check (amount > 0)`
    - `payments_reference_len_chk check (reference is null or char_length(reference) <= 120)`
    - `payments_notes_len_chk check (notes is null or char_length(notes) <= 1000)`
  - Indexes `(firm_id, invoice_id)` and `(firm_id, paid_on)`.
  - Audit trigger `payments_audit`.
- **`public.attachments` table:** standard columns plus `payment_id uuid`, `storage_path text not null`, `file_name text not null`, `mime_type text not null`, `size_bytes integer not null`.
  - Constraints:
    - `attachments_payment_fk (firm_id, payment_id) → payments on delete cascade`
    - `attachments_owner_chk check (payment_id is not null)` (Phase 5 replaces it with "exactly one owner")
    - `attachments_mime_chk check (mime_type in ('application/pdf','image/png','image/jpeg','image/heic'))`
    - `attachments_size_chk check (size_bytes > 0 and size_bytes <= 10485760)`
    - `attachments_path_chk check (storage_path like 'firms/' || firm_id::text || '/attachments/%')`
    - unique `storage_path`
  - Index `(firm_id, payment_id)`.
- **Privileges:** `payments` and `attachments`: revoke all from anon and authenticated; grant select to authenticated; RLS select `has_role(firm_id,'{admin,manager}')`. There are no write grants.
- **Internal `public.invoice_apply_payments(p_invoice uuid)`** (not granted to anyone): `amount_paid = coalesce(sum(payments.amount), 0)`; status per Global Constraints. It touches only `issued`, `partly_paid` and `paid` invoices.
- **Security-definer functions.** Each one locks the invoice row first (`for update`), raises `INVOICE_NOT_FOUND` / `PAYMENT_NOT_FOUND`, then requires `has_role(firm,'{admin,manager}')` (`42501`):
  - `public.record_payment(p_invoice uuid, p_amount numeric, p_paid_on date, p_method payment_method, p_reference text, p_notes text) returns uuid`:
    - Status must be `issued` or `partly_paid`, else `PAYMENT_NOT_ALLOWED`.
    - `PAYMENT_FUTURE` when `p_paid_on > current_date`.
    - `PAYMENT_TOO_LARGE` when `amount_paid + p_amount > total`.
    - Inserts the payment (reference and notes trimmed, empty → null), then applies payments.
  - `public.update_payment_details(p_payment uuid, p_paid_on date, p_method payment_method, p_reference text, p_notes text) returns void`:
    - Invoice status must be `issued`, `partly_paid` or `paid`, else `PAYMENT_LOCKED`.
    - `PAYMENT_FUTURE` rule as above.
    - It has no amount parameter.
  - `public.delete_payment(p_payment uuid) returns setof text`:
    - Same status rule (`PAYMENT_LOCKED`).
    - Collects the payment's attachment `storage_path`s, deletes the payment (attachments cascade), applies payments, and returns the paths so the app can remove the files.
  - `public.add_payment_attachment(p_payment uuid, p_storage_path text, p_file_name text, p_mime text, p_size integer) returns uuid`:
    - Same status rule.
    - The path must start with `firms/{firm}/attachments/payments/{payment}/`, else `attachments_path_chk`-style raise with the message text containing `attachments_path_chk`.
    - `file_name` is cut to 120 characters.
  - `public.delete_attachment(p_attachment uuid) returns text`:
    - `ATTACHMENT_NOT_FOUND`, then the role check, then the owning invoice's status rule.
    - Deletes the row and returns its `storage_path`.
- **Lock order:** invoice → payment → attachments. Delete and update find the invoice through the payment without locking the payment first, then lock the invoice, then re-read the payment.
- **Phase 3 interplay:** `void_invoice` already refuses when `amount_paid > 0`.

- [ ] **Step 1: Write failing tests.** Use `seedApprovedHours` from `invoice-fixtures.ts` plus the Phase 3 RPCs to get an issued invoice. For a round total, use a manual-line-only draft (1 × 1000.00) issued via `issue_invoice`.
  - **Record:** 400 → `amount_paid '400.00'`, status `partly_paid`; then 600 → `'1000.00'`, `paid`; then 0.01 more → `PAYMENT_NOT_ALLOWED`.
  - **Too large:** 1000.01 on a fresh 1000.00 invoice → `PAYMENT_TOO_LARGE`; nothing inserted.
  - **Concurrent (Review Focus 1):** two `record_payment` calls of 600 via `Promise.all` → exactly one ok and one `PAYMENT_TOO_LARGE`; `amount_paid '600.00'`.
  - **Rejected inputs:**
    - amount 0 → `payments_amount_chk`
    - future date → `PAYMENT_FUTURE`
    - a draft or void invoice → `PAYMENT_NOT_ALLOWED`
  - **Edit:** `update_payment_details` changes date, method, reference and notes; the amount is unchanged; it works on a `paid` invoice; on a void invoice → `PAYMENT_LOCKED`. (To void, delete the payments first, then void.)
  - **Delete (Review Focus 2):** with a paid invoice and two payments, delete one → `partly_paid` and `amount_paid` reduced. The returned paths list the attachment added earlier, and the attachment row is gone. `audit_log` has a `payments` delete row whose `before` carries the amount.
  - **Void interplay (Review Focus 4):** `void_invoice` with a payment → `INVOICE_HAS_PAYMENTS`. Delete all payments → status `issued` → void succeeds.
  - **Attachments:**
    - A path outside the payment folder → error containing `attachments_path_chk`.
    - A correct path → row saved.
    - Size 10,485,761 → `attachments_size_chk`.
    - MIME `application/zip` → `attachments_mime_chk`.
    - `delete_attachment` returns the path.
  - **Access:**
    - A consultant calling any function → `42501`.
    - The firm B manager on firm A's invoice or payment → error, unchanged.
    - A consultant selecting `payments` or `attachments` → 0 rows.
    - A manager `insert` into `payments` → error.
- [ ] **Step 2:** Run `npm run test:int -- payments-db` → FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `npm run db:reset && npm run db:types`; `npm run test:int` → all PASS.
- [ ] **Step 5: Commit** `feat(db): payments with status recompute, attachments, audit`

---

### Task 3: Payments data module, file storage and download route

**Files:**
- Create: `src/modules/payments/schemas.ts`, `data.ts`, `storage.ts`, `actions.ts`, `src/app/f/[firmId]/attachments/[id]/route.ts`
- Modify: `next.config.ts` (`experimental.serverActions.bodySizeLimit: '55mb'`), `src/modules/invoices/data.ts` (`InvoiceDetail` gains `balanceDue: string`, selected as `(total - amount_paid)::text`)
- Test: `tests/integration/payments.test.ts`

**Interfaces:**
- **Types:**
  - `PaymentRow = { id; amount: string; paidOn: string; method: PaymentMethod; reference: string | null; notes: string | null; attachments: { id; fileName: string; mimeType: string; sizeBytes: number }[] }`
  - `UploadFile = { name: string; type: string; size: number; bytes: Uint8Array }`
- **`data.ts`** (all functions take `(db, firmId, …)` and return a `Result`; each confirms the invoice or payment belongs to `firmId` with an `.eq('firm_id', firmId)` lookup first and fails with `'Invoice not found.'` / `'Payment not found.'`):
  - `listPayments(db, firmId, invoiceId)`: newest `paid_on` first, with attachments.
  - `recordPayment(db, firmId, invoiceId, input: { amount: string; paidOn: string; method: PaymentMethod; reference: string | null; notes: string | null })` → `{ id }`.
  - `updatePaymentDetails(db, firmId, paymentId, input: { paidOn; method; reference; notes })`.
  - `deletePayment(db, firmId, paymentId)`: calls the RPC, then removes the returned paths from storage. A storage removal failure is logged and does not fail the result.
- **`storage.ts`** (`import 'server-only'`):
  - `attachFiles(db, firmId, paymentId, files: UploadFile[], validate = validateAttachment)` → `Result<{ added: number; rejected: { name: string; error: string }[] }>`.
    - More than `MAX_FILES_PER_UPLOAD` files → `fail('Attach up to 5 files at a time.')` before any upload.
    - Each file is validated; invalid ones go to `rejected` and are never uploaded.
    - Valid files are uploaded to `firms/{firmId}/attachments/payments/{paymentId}/{randomUUID}.{ext}` with the sniffed MIME, then `add_payment_attachment` is called. If that call fails, the uploaded object is removed and the file goes to `rejected`.
  - `deleteAttachment(db, firmId, attachmentId)`: RPC, then storage removal.
  - `readAttachment(db, firmId, attachmentId)` → `Result<{ bytes: Uint8Array; mimeType: string; fileName: string }>`: looks the row up with a firm filter, then downloads it.
- **`schemas.ts`:**
  - `paymentInputSchema`:
    - `amount` via `parseMoney`, must be > 0 (`'Enter an amount above 0.'`).
    - `paidOn` is an ISO date that is not in the future (`'The payment date can't be in the future.'`).
    - `method` is one of the enum values.
    - `reference` ≤ 120 characters; `notes` ≤ 1000 characters (`'Keep this to N characters or fewer.'`).
  - `paymentDetailsSchema`: the same without `amount`.
- **`actions.ts`** (all use `requireFirmRole(firmId, ['admin','manager'])` and revalidate `/f/{firmId}/invoices/{invoiceId}` and `/f/{firmId}/invoices/unpaid`):
  - `recordPaymentAction(firmId, invoiceId, formData)`:
    - Fields `amount`, `paidOn`, `method`, `reference`, `notes`, and `files` (multiple).
    - Records the payment, then attaches files.
    - Returns `{ ok: true, data: { id, fileWarning: string | null } }`. `fileWarning` is `'Payment recorded, but some files weren't attached: {names}.'` when any were rejected. File problems never undo the payment.
    - Pre-validation of the number of files happens before recording.
  - `updatePaymentAction(firmId, invoiceId, paymentId, formData)`: details plus optional extra `files`.
  - `deletePaymentAction(firmId, invoiceId, paymentId)`.
  - `deleteAttachmentAction(firmId, invoiceId, attachmentId)`.
- **Route `GET /f/{firmId}/attachments/{id}`:**
  - `runtime = 'nodejs'`; `requireFirmRole(firmId, ['admin','manager'])`.
  - Streams via `readAttachment`.
  - Headers:
    - `Content-Type` = the stored MIME
    - `Content-Disposition: inline; filename="{sanitised display name}"`
    - `Cache-Control: private, no-store`
    - `X-Content-Type-Options: nosniff`
  - Unknown or other-firm id → 404.

- [ ] **Step 1: Write failing integration tests:**
  - `recordPayment` then `listPayments` → one row with `amount '400.00'`.
  - `attachFiles`:
    - A small valid PDF and PNG → `added 2`; `listPayments` shows both with sniffed MIME types.
    - Disguised file (Review Focus 3): an `MZ`-header file named `.pdf` → `rejected` with the type message, and no object under the payment's folder (list the folder via storage).
    - A 10,485,761-byte PDF → rejected with the size message.
    - 6 files → `fail('Attach up to 5 files at a time.')`, nothing uploaded.
  - `readAttachment` returns the bytes and MIME for a valid id. Firm B's admin calling it with firm A's attachment id → fail.
  - `deletePayment` (Review Focus 2): the attachment objects are gone from storage (list the folder → empty) and the invoice status is recomputed.
  - `updatePaymentDetails` changes the method; the amount stays.
  - A user who is manager in firms A and B calls `recordPayment(db, firmA, invoiceOfFirmB, …)` → `'Invoice not found.'`, nothing recorded.
- [ ] **Step 2:** Run `npm run test:int -- payments.test` → FAIL.
- [ ] **Step 3:** Implement. Add `bodySizeLimit` to `next.config.ts`.
- [ ] **Step 4:** Run → PASS; `npm run build` succeeds; lint and typecheck are clean.
- [ ] **Step 5: Commit** `feat(payments): data module, validated file storage, download route`

---

### Task 4: Unpaid invoices and ageing (database and data)

**Files:**
- Create: `supabase/migrations/20261109000019_receivables.sql`, `src/modules/receivables/data.ts`, `tests/integration/receivables.test.ts`

**Interfaces:**
- `public.unpaid_invoices(p_firm uuid, p_client uuid) returns table (invoice_id uuid, number text, client_id uuid, client_name text, issue_date date, due_date date, total text, amount_paid text, balance_due text, days_overdue integer)` (stable, security definer).
  - Admins and Managers of `p_firm` only (`42501`).
  - Rows: invoices with status `issued` or `partly_paid`, optionally for one client.
  - `days_overdue = current_date - due_date`.
  - Ordered by `due_date`, then number.
- `public.unpaid_ageing(p_firm uuid, p_client uuid) returns table (bucket text, balance_due text, invoice_count integer)`.
  - Same permission and row rules.
  - Always returns five rows in the order `current, d1_30, d31_60, d61_90, d90_plus`. Each sums `total - amount_paid` and uses `'0.00'` and `0` for empty buckets.
  - Bucket rules match `bucketFor` in `ageing.ts`.
- `receivables/data.ts`:
  - `UnpaidRow = { invoiceId; number: string; clientId; clientName; issueDate; dueDate; total: string; amountPaid: string; balanceDue: string; daysOverdue: number }`
  - `AgeingRow = { bucket: AgeBucket; balanceDue: string; invoiceCount: number }`
  - `listUnpaid(db, firmId, clientId: string | null)`
  - `getAgeing(db, firmId, clientId: string | null)`
  - `getOutstandingSummary(db, firmId)` → `{ outstanding: string; overdue: string; overdueCount: number }`, derived from the ageing rows by a small SQL sum. Add `public.outstanding_summary(p_firm uuid)` to the same migration rather than adding in TypeScript.

- [ ] **Step 1: Write failing tests (Review Focus 5).**
  - Create issued invoices via manual-line drafts, then set their `due_date` with `adminDb` relative to `current_date` (compute in SQL via `rpc` or from `todayIso()`):
    - due today, 500.00
    - 1 day overdue, 100.00
    - 30 days overdue, 200.00
    - 31 days overdue, 300.00
    - 90 days overdue, 400.00
    - 91 days overdue, 600.00 with a 250.00 payment, so the balance is 350.00
    - one fully paid invoice
    - one void invoice
  - Expected `unpaid_ageing`:
    - `current '500.00'/1`
    - `d1_30 '300.00'/2`
    - `d31_60 '300.00'/1`
    - `d61_90 '400.00'/1`
    - `d90_plus '350.00'/1`
  - Expected `unpaid_invoices`: 6 rows; the paid and void invoices are excluded; `days_overdue` matches; the partly paid row has `balance_due '350.00'`.
  - The client filter returns only that client's rows and buckets.
  - `outstanding_summary` → outstanding `'1850.00'`, overdue `'1350.00'`, overdueCount 5.
  - A consultant calling the functions → `42501`.
  - Data functions return the same values, as strings.
- [ ] **Step 2:** Run `npm run test:int -- receivables` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run db:reset && npm run db:types`; `npm run test:int` → all PASS.
- [ ] **Step 5: Commit** `feat(receivables): unpaid invoices, ageing and outstanding summary`

---

### Task 5: Payments on the invoice page

**Files:**
- Create: `src/app/f/[firmId]/invoices/[id]/payments-section.tsx`
- Modify: `src/app/f/[firmId]/invoices/[id]/page.tsx`
- Test: `tests/e2e/payments.spec.ts`

**Interfaces:**
- **Where it shows:** on invoices with status `issued`, `partly_paid` or `paid` (and read-only on `void`), below the totals.
- **Summary:** `Paid` (amount paid) and `Balance due`, with a status badge (Issued / Partly paid / Paid / Void).
- **Payments table:** Date, Method, Reference, Amount, Files. Each file links to `/f/{firmId}/attachments/{id}` in a new tab, labelled with its file name.
- **Each row's actions:** `Edit` opens an inline form with `Payment date`, `Method`, `Reference`, `Notes` and `Add files`, plus `Save`. Each existing file has a `Remove` button. `Delete` confirms with `Delete this payment of {amount}? Its files are deleted too.`
- **`Record payment` form** (only for `issued` / `partly_paid`):
  - `Amount` is prefilled with the balance due. `Payment date` defaults to today.
  - `Method` is a select. `Reference` and `Notes` are free text.
  - `Files` is `<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.heic,application/pdf,image/png,image/jpeg,image/heic">`.
  - `Record payment` submits. Field errors appear under the fields, the action error in `role="alert"`, and `fileWarning` in `role="status"`.
- **Void and draft invoices:** no form, no edit or delete controls. The table is shown read-only for void invoices.
- **Invoice list status filter:** the `Partly paid` and `Paid` filters already exist from Phase 3; confirm they work.

- [ ] **Step 1: Write failing e2e tests** (issue a manual-line invoice of 1 × `1234.56` via the Phase 3 RPCs as the manager in setup):
  - **Partial payment with a file:** open the invoice → `Record payment` with amount `500.00`, method `Bank transfer`, reference `TRX-881`, and a file `tests/e2e/fixtures/remittance.pdf` (add a tiny valid PDF fixture) → status `Partly paid`, `Balance due` `734.56`, the row shows `TRX-881` and a `remittance.pdf` link. Requesting that link returns 200 with `application/pdf`.
  - **Pay the rest:** record `734.56` → status `Paid`, no `Record payment` form.
  - **Overpayment refused:** on a fresh invoice, amount `2000` → `This payment is more than the balance due.`
  - **Disguised file:** a fixture `fake.pdf` containing `MZ...` attached to a valid payment → payment recorded, and the warning names `fake.pdf`.
  - **Edit and delete:** edit the reference to `TRX-882` → shown. Delete the 500.00 payment (accept dialog) → status `Partly paid`, balance `500.00`.
  - **Consultant blocked:** a consultant requesting an attachment URL → 404.
- [ ] **Step 2:** Run `npm run test:e2e -- payments` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS (also `invoices` e2e, to check nothing regressed).
- [ ] **Step 5: Commit** `feat(payments): record, edit and delete payments on the invoice page`

---

### Task 6: Unpaid Invoices page, dashboard, README and full gate

**Files:**
- Create: `src/app/f/[firmId]/invoices/unpaid/page.tsx`
- Modify: `src/app/f/[firmId]/invoices/page.tsx` (link `Unpaid invoices`), `src/app/f/[firmId]/layout.tsx` (nav `Unpaid` → `/invoices/unpaid`, admin/manager, after `Invoices`), `src/app/f/[firmId]/page.tsx` + `src/modules/firms/dashboard.ts` (cards `Outstanding` and `Overdue`), `README.md`
- Test: `tests/e2e/payments.spec.ts` (unpaid section), `tests/integration/dashboard.test.ts`

**Interfaces:**
- **`/invoices/unpaid`** (admin/manager; others 404):
  - A `Client` filter (`?client=`; all clients by default).
  - Five ageing cards (label from `AGE_BUCKET_LABELS`, balance via `formatMoney`, invoice count).
  - A table:
    - Columns: Number (link to the invoice), Client, Issue date, Due date, Total, Paid, Balance due, Status.
    - `overdueLabel(daysOverdue)` is shown in red text next to the due date when overdue.
    - A `Record payment` link on each row goes to the invoice page's payments section (`/invoices/{id}#payments`).
  - Empty state: `"Nothing outstanding."`
- **Dashboard (admin/manager):**
  - `Outstanding` card: total balance due, linking to `/invoices/unpaid`.
  - `Overdue` card: overdue total and count.
  - `dashboard.ts` gets these from `getOutstandingSummary`.
- **README "Payments" section:**
  - Who can record, edit and delete payments.
  - The amount can't be edited (delete and re-record instead).
  - Automatic status changes.
  - Overpayments are refused.
  - Allowed files: PDF/PNG/JPEG/HEIC, 10 MB, 5 per upload.
  - Files are checked by content.
  - Deleting a payment deletes its files and stays in the audit log.
  - The ageing buckets.
  - Voiding requires removing payments first.

- [ ] **Step 1: Write failing tests:**
  - e2e: three issued invoices for two clients, one 45 days overdue (due date set via `adminDb`). The `Unpaid` page shows `Overdue by 45 days` and the 31–60 card with that balance. Filtering by the other client hides it.
  - e2e: the manager dashboard shows `Outstanding` with the summed balance.
  - Integration: the dashboard counts include the outstanding figures as strings.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement, and write the README section.
- [ ] **Step 4:** Full gate after `npm run db:reset` (nothing else on port 3000): `npm run lint && npm run typecheck && npm run test:unit && npm run test:int && npm run test:e2e` → all PASS.
- [ ] **Step 5: Commit** `feat(payments): unpaid invoices with ageing, dashboard totals; docs: payments`
