# Phase 5: Expenses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers and Admins record firm expenses with a category, payee, amount, optional client/project and optional receipts, manage the category list, and filter the expenses list with exact totals. Uploaded files for both receipts and payment proofs can no longer be overwritten or deleted outside the app.

**Architecture:**
- Two new tables: `expense_categories` (seeded per firm) and `expenses`. Admins and Managers write to them directly under RLS. Triggers enforce the rules: a project sets the client, retired categories are refused, and future dates are refused.
- The Phase 4 `attachments` table gains an `expense_id` owner. Its upload flow moves into a shared `attachments` module: signed upload into an `incoming-` holding name, then a server check, move and register. Payments and expenses both use it.
- Storage policies stop users from updating or deleting anything under the attachments and invoice-PDF folders, and only allow inserting `incoming-*` objects. The server performs moves and removals with the service-role client, after its own permission checks.
- Stale `incoming-*` objects older than 24 hours are swept whenever the same owner's folder is touched.

**Tech Stack:** As Phases 1–4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-08-consulting-ops-design.md` — sections 3.2 (expenses row), 4.4 (expense_categories, expenses, attachments), 4.5, 5.4 (items 1–5), 6, 7, 9 phase 5.

## Global Constraints

- **Carried over:** everything in the Phase 1–4 Global Constraints still holds:
  - standard business columns plus `set_updated_at()`
  - composite `(firm_id, x_id)` FKs with `unique (firm_id, id)`
  - RLS on every table, and nothing readable by `anon`
  - `Result<T>` data functions, with errors only via `mapDbError`
  - every new SQL function has `set search_path = ''`, fully qualified names, revoke from public/anon, and an explicit grant
  - money is `numeric(12,2)`, summed in SQL and moved as strings
- **Expenses:**
  - `amount > 0` (tax-inclusive total)
  - `spent_on <= current_date`
  - `payee` is trimmed, 1–200 characters
  - `notes` is ≤ 1000 characters
  - When `project_id` is set, `client_id` always equals the project's client, set by a trigger that overrides the caller.
- **Categories:**
  - `name` is trimmed, 1–60 characters, and unique per firm on `lower(btrim(name))`.
  - `active` defaults to true.
  - Each firm is seeded with Travel, Software, Office, Contractors, Professional fees and Other, at firm creation and by backfill.
  - A category with expenses can't be deleted. Retire it instead.
  - A retired category can't be set on an inserted expense, or on an updated one whose category changes.
- **Roles:**
  - Expenses and categories are readable and writable by Admins and Managers only.
  - Consultants see nothing from this phase.
- **Attachments:**
  - Same file rules as Phase 4: PDF/PNG/JPEG/HEIC, checked by signature, ≤ 10 MB, ≤ 5 per upload.
  - Folders are `firms/{firm}/attachments/payments/{payment_id}/` and `firms/{firm}/attachments/expenses/{expense_id}/`.
  - Holding names are `incoming-{uuid}` and final names are `{uuid}.{ext}`.
  - `attachments` has exactly one owner: `num_nonnulls(payment_id, expense_id) = 1`.
- **Storage write model (new):**
  - Under `firms/{firm}/attachments/`, authenticated users may only insert objects whose last path segment matches `incoming-%`, at depth 6. They may not update or delete anything there.
  - Under `firms/{firm}/invoices/`, they may insert, but not update or delete.
  - Logo rules are unchanged.
  - Every move or removal in these folders is done in server code with the service-role client (`src/lib/supabase/admin.ts`), and only after the app's own firm, role and ownership checks.
- **Sweep:** whenever an owner's folder is touched (create targets, finalize, delete owner), `incoming-*` objects in that folder older than 24 hours are removed. Deleting a payment or expense removes everything in its folder.
- **Migrations:** files are named `20261109000021_expenses.sql` and `20261109000022_storage_hardening.sql`. After any migration, run `npm run db:reset && npm run db:types`.
- **E2E:** tests run against a production build with `workers: 1`. Each test creates its own firm, and money values are distinctive.

## Review Focus

1. **A project from client A picked while client B is selected:** the expense saves with client A. Changing the project later moves the client too. Clearing the project keeps whatever client is given. Test in Task 1.
2. **Retired category:**
   - Existing expenses keep the category.
   - A new expense with it is refused with "That category is retired. Pick another or restore it."
   - Restoring the category makes it usable again.
   - Deleting a category that has expenses is refused.
   - Test in Task 1.
3. **Near-duplicate names:** with "Travel" present, adding " travel " is refused with "A category with that name already exists." Test in Task 1.
4. **A manager going around the app:** calling the Storage API directly to overwrite, move or delete a stored receipt or payment proof, or to upload a non-`incoming-` name into an attachments folder, is refused. The app's own delete still removes the file. Test in Task 2.
5. **Filters combined:** category plus client plus date range plus "no receipt" returns exactly the matching expenses, with an exact total and count computed in SQL. Test in Task 3.

---

## File Structure

```
supabase/migrations/
  20261109000021_expenses.sql            # categories (+ seed), expenses, triggers, RLS, audit, attachments.expense_id, expense attachment RPCs, totals
  20261109000022_storage_hardening.sql   # storage policies for attachments/ and invoices/
src/lib/db-errors.ts (+ test)            # expense/category messages
src/modules/attachments/                 # shared: storage.ts (targets, finalize, delete, download URL, sweep, removeOwnerFolder), actions-helpers
src/modules/payments/                    # storage.ts now delegates to attachments; behaviour unchanged
src/modules/invoices/pdf/storage.ts      # orphan PDF removal via service role
src/modules/expenses/                    # schemas.ts data.ts actions.ts
src/modules/expense-categories/          # data.ts actions.ts schemas.ts
src/components/attachments/              # upload-files.ts (moved from invoices/[id]), file-list.tsx (shared list + remove)
src/app/f/[firmId]/
  expenses/page.tsx  expenses/new/page.tsx  expenses/[id]/page.tsx  expenses/expense-form.tsx
  expenses/categories/page.tsx  expenses/categories/category-forms.tsx
tests/integration/ expenses-db.test.ts  storage-hardening.test.ts  expenses.test.ts  (payments tests keep passing)
tests/e2e/expenses.spec.ts
```

---

### Task 1: Expenses schema, categories and attachment ownership

**Files:**
- Create: `supabase/migrations/20261109000021_expenses.sql`, `tests/integration/expenses-db.test.ts`
- Modify: `src/lib/db-errors.ts` (+ test), `src/lib/supabase/types.ts` (regenerated), `tests/integration/invoice-fixtures.ts` or a new `tests/integration/expense-fixtures.ts`

**Interfaces:**
- **`public.expense_categories`**
  - Columns: the standard columns, plus `name text not null` and `active boolean not null default true`.
  - Constraints:
    - `expense_categories_firm_id_id_key unique (firm_id, id)`
    - `expense_categories_name_chk check (char_length(btrim(name)) between 1 and 60)`
    - unique index `expense_categories_firm_name_key on (firm_id, lower(btrim(name)))`
  - Triggers:
    - a before-insert/update trigger stores `btrim(name)`
    - `firms_seed_expense_categories`, after insert on `firms` (security definer), inserts the six defaults
    - the migration backfills the six defaults for every existing firm that has none
- **`public.expenses`**
  - Columns: the standard columns, plus:
    - `spent_on date not null`
    - `category_id uuid not null`
    - `payee text not null`
    - `amount numeric(12,2) not null`
    - `client_id uuid`
    - `project_id uuid`
    - `notes text`
  - Constraints:
    - `expenses_firm_id_id_key unique (firm_id, id)`
    - `expenses_category_fk (firm_id, category_id) → expense_categories on delete restrict`
    - `expenses_client_fk (firm_id, client_id) → clients on delete restrict`
    - `expenses_project_fk (firm_id, project_id) → projects on delete restrict`
    - `expenses_amount_chk check (amount > 0)`
    - `expenses_payee_chk check (char_length(btrim(payee)) between 1 and 200)`
    - `expenses_notes_chk check (notes is null or char_length(notes) <= 1000)`
  - Indexes: `(firm_id, spent_on)`, `(firm_id, category_id)`, `(firm_id, client_id)`, `(firm_id, project_id)`.
  - `expenses_audit` trigger.
- **Trigger `expenses_apply_rules`** (before insert/update, security definer) does the following, in order:
  1. Trims `payee`; an empty `notes` becomes null.
  2. Raises `EXPENSE_FUTURE` when `spent_on > current_date`.
  3. Raises `CATEGORY_RETIRED` when the category is inactive and (insert, or `category_id` changed).
  4. When `project_id` is not null, sets `client_id` to the project's `client_id` (same firm).
- **Privileges:** both tables get select, insert, update and delete for authenticated. RLS on all four commands is `has_role(firm_id,'{admin,manager}')` (`with check` the same).
- **`attachments` changes:**
  - Add `expense_id uuid` with `attachments_expense_fk (firm_id, expense_id) → expenses on delete cascade`.
  - Replace `attachments_owner_chk` with `check (num_nonnulls(payment_id, expense_id) = 1)`.
  - Add index `(firm_id, expense_id)`.
  - Add `attachments_audit` (audit trigger on attachments).
- **`public.add_expense_attachment(p_expense uuid, p_storage_path text, p_file_name text, p_mime text, p_size integer) returns uuid`** (security definer):
  - Locks the expense `for update` and raises `EXPENSE_NOT_FOUND` if missing.
  - Requires `has_role` (`42501`).
  - Applies the same path rules as `add_payment_attachment`, with folder `firms/{firm}/attachments/expenses/{expense}/` and a single segment that isn't `.` or `..`.
  - Cuts the file name to 120 characters.
- **`public.delete_attachment(p_attachment uuid) returns text`:** redefine it so that for an expense-owned row it locks the expense (no status rule). The payment path stays unchanged.
- **`public.expense_totals(...) returns table (total text, expense_count integer)`** (stable, security definer, admin/manager only, else `42501`):
  - Parameters: `p_firm uuid`, `p_from date`, `p_to date`, `p_category uuid`, `p_client uuid`, `p_project uuid`, `p_missing_receipt boolean`.
  - A null parameter means no filter.
  - `p_missing_receipt = true` keeps expenses with no attachment rows.
  - The total is `coalesce(sum(amount),0)::numeric(12,2)::text`.
- **`mapDbError` additions:**

| Needle | Message |
|---|---|
| `EXPENSE_NOT_FOUND` | Expense not found. |
| `EXPENSE_FUTURE` | The expense date can't be in the future. |
| `CATEGORY_RETIRED` | That category is retired. Pick another or restore it. |
| `expense_categories_firm_name_key` | A category with that name already exists. |
| `expense_categories_name_chk` | Enter a category name (up to 60 characters). |
| `expenses_category_fk` + `is still referenced` (delete) | This category has expenses, so it can't be deleted. Retire it instead. |
| `expenses_category_fk` (other) | Category not found. |
| `expenses_client_fk` (insert/update) | Client not found. |
| `expenses_project_fk` (insert/update) | Project not found. |
| `expenses_amount_chk` | Enter an amount above 0. |
| `expenses_payee_chk` | Enter who was paid (up to 200 characters). |
| `expenses_notes_chk` | Keep notes to 1000 characters or fewer. |

  The `is still referenced` split follows the Phase 3 `BY_FK` pattern. A client or project delete blocked by expenses maps to `'This client has expenses, so it can't be deleted.'` / `'This project has expenses, so it can't be deleted.'`.

- [ ] **Step 1: Write failing tests:**
  - **Seeding:** `newFirm()` gets the six categories, all active.
  - **Duplicate names (Review Focus 3):** inserting `' travel '` fails with `expense_categories_firm_name_key`. Inserting `'  Meals  '` is stored as `'Meals'`.
  - **Basic insert:** an expense with amount `'123.45'` is created by the manager. Selecting it back as text gives `'123.45'`.
  - **Bad values:**
    - amount 0 fails with `expenses_amount_chk`
    - a future date fails with `EXPENSE_FUTURE`
    - a blank payee fails with `expenses_payee_chk`
  - **Project sets the client (Review Focus 1):**
    - Given project P of client A and client B, an insert with `{ client_id: B, project_id: P }` stores `client_id = A`.
    - Updating the project to Q of client C sets the client to C.
    - Setting the project to null with client B stores B.
  - **Retired category (Review Focus 2):**
    - Retiring Travel leaves the existing expense updatable on other fields.
    - A new expense with Travel fails with `CATEGORY_RETIRED`.
    - Changing an expense's category to Travel fails with `CATEGORY_RETIRED`.
    - After restoring Travel, it works.
    - Deleting a used category fails with an `expenses_category_fk` error.
    - Deleting an unused category succeeds.
  - **Access:**
    - A consultant gets 0 rows on select and an error on insert, for both tables.
    - Firm B's manager can't see or update firm A's rows.
    - Inserting an expense that points at another firm's project fails on the composite FK.
  - **`expense_totals`:** across 4 expenses (two categories, two clients, one with an attachment row inserted via `add_expense_attachment` and a fake path in its folder), each filter and a combination give the exact total and count, and `p_missing_receipt` works. A consultant calling it gets `42501`.
  - **Attachment rows:**
    - `add_expense_attachment` with a path outside the folder fails with `attachments_path_chk`.
    - Inserting an attachment row with both owners, via adminDb, fails with `attachments_owner_chk`.
    - Deleting the expense cascades to its attachment rows.
  - **Audit:** `audit_log` has `expenses` insert, update and delete rows.
  - **`mapDbError`:** one test row per new message.
- [ ] **Step 2:** Run `npm run test:int -- expenses-db` and `npm run test:unit`. Expect FAIL.
- [ ] **Step 3:** Write the migration and the messages.
- [ ] **Step 4:** Run `npm run db:reset && npm run db:types`, then `npm run test:int` and `npm run test:unit`. Expect all PASS, including the Phase 4 payments tests.
- [ ] **Step 5: Commit** `feat(db): expenses, categories, expense attachments, totals`

---

### Task 2: Shared attachments module and storage hardening

**Files:**
- Create: `supabase/migrations/20261109000022_storage_hardening.sql`, `src/modules/attachments/storage.ts`, `tests/integration/storage-hardening.test.ts`
- Modify: `src/modules/payments/storage.ts` (delegate to the shared module), `src/modules/payments/data.ts` (`deletePayment` removes the whole folder), `src/modules/invoices/pdf/storage.ts` (orphan removal via service role), `tests/integration/payments.test.ts` (if helper paths move)

**Interfaces:**
- **`src/modules/attachments/storage.ts`** (`import 'server-only'`):
  - `type Owner = { kind: 'payment'; id: string } | { kind: 'expense'; id: string }`
  - `ownerFolder(firmId: string, owner: Owner): string` returns `firms/{firm}/attachments/{payments|expenses}/{id}/`.
  - `createUploadTargets(db, firmId, owner, files: DeclaredFile[])` behaves as in Phase 4. Ownership and permission checks are owner-specific: a payment must take files per its invoice status, and an expense must exist in the firm. It sweeps stale incoming objects first.
  - `finalizeUploads(db, firmId, owner, items, validate = validateAttachment)` behaves as in Phase 4, with these differences:
    - Downloads, moves and removals use the service-role client.
    - It registers via `add_payment_attachment` or `add_expense_attachment`, called with the user's `db` so role checks and the audit actor apply.
    - It sweeps stale incoming objects.
  - `deleteAttachment(db, firmId, attachmentId)`: the RPC runs with the user's `db`, and the file removal uses the service role.
  - `attachmentDownloadUrl(db, firmId, attachmentId)`: the lookup uses the user's `db` (RLS), and signing uses the service role.
  - `removeOwnerFolder(firmId, owner)` lists the folder and removes every object in it with the service role.
  - `sweepIncoming(firmId, owner, now = new Date())` removes `incoming-*` objects whose `created_at` is more than 24 hours before `now`.
- **`payments/storage.ts`** keeps its exported names and signatures, which call the shared module with `{ kind: 'payment', id }`. All Phase 4 payments tests must still pass unchanged, apart from the import of moved helpers.
- **`deletePayment`** removes the payment folder via `removeOwnerFolder` after the RPC succeeds, instead of only the returned paths.
- **Invoice PDFs:** `generateAndStorePdf` cleanup after a failed `set_invoice_pdf` uses the service role.
- **Storage policies migration:** drop and recreate `firm_files_insert`, `firm_files_update` and `firm_files_delete`. Let `seg(n)` mean `(storage.foldername(name))[n]`, and let "manager" mean `has_role(firm, '{admin,manager}')`.
  - **Insert:**
    - `seg(3) = 'logo'` → admin
    - `seg(3) = 'attachments'` → manager, `array_length(storage.foldername(name),1) = 5` (firms, firm, attachments, kind, owner), `seg(4) in ('payments','expenses')`, and `storage.filename(name) like 'incoming-%'`
    - `seg(3) = 'invoices'` → manager
    - anything else → manager
  - **Update:**
    - `seg(3) = 'logo'` → admin
    - `seg(3) in ('attachments','invoices')` → `false`
    - else → manager
  - **Delete:** same as update.
  - The select policy is unchanged.

- [ ] **Step 1: Write failing tests (`storage-hardening.test.ts`, Review Focus 4):**
  - **Holding-area uploads:** as a manager, uploading `.../attachments/payments/{pid}/incoming-{uuid}` directly succeeds. Uploading `.../attachments/payments/{pid}/evil.pdf` fails, and so does uploading to `.../attachments/x.pdf` at the wrong depth.
  - **Stored files are protected:** for a finalized payment attachment, a manager's direct `update` (upsert), `move` and `remove` on its path all fail, and the object is still there, checked via the service role.
  - **Invoice PDFs are protected:** a manager's `remove` of an invoice PDF path fails.
  - **The app path still works:** `deleteAttachment`, `deletePayment` and the PDF orphan cleanup still remove the files.
  - **Sweep:**
    - An `incoming-*` object is removed by `sweepIncoming(firmId, owner, now)` when `now` is passed as 25 hours after the upload.
    - A fresh one is kept.
    - `removeOwnerFolder` empties the folder.
  - **Expense owner:** `createUploadTargets` with an expense owner succeeds, and finalizing a real PDF registers an attachment with `expense_id` set.
- [ ] **Step 2:** Run `npm run test:int -- storage-hardening`. Expect FAIL.
- [ ] **Step 3:** Implement the migration and the refactor.
- [ ] **Step 4:** Run `npm run db:reset && npm run db:types`, then `npm run test:int`. Expect all PASS. In particular `payments`, `payments-db` and `invoices` must be unchanged and green.
- [ ] **Step 5: Commit** `feat(storage): shared attachments module, server-only file writes, stale upload sweep`

---

### Task 3: Expenses and categories data modules

**Files:**
- Create: `src/modules/expenses/{schemas,data,actions}.ts`, `src/modules/expense-categories/{schemas,data,actions}.ts`
- Test: `tests/integration/expenses.test.ts`

**Interfaces:**
- **`expense-categories/data.ts`:**
  - `CategoryRow = { id; name: string; active: boolean; expenseCount: number }`
  - `listCategories(db, firmId, opts?: { activeOnly?: boolean })` returns rows ordered by name.
  - `createCategory(db, firmId, name)` returns `{ id }`.
  - `renameCategory(db, firmId, id, name)`
  - `setCategoryActive(db, firmId, id, active: boolean)`
  - `deleteCategory(db, firmId, id)`
  - All of them filter by `firm_id`.
- **`expenses/data.ts`:**
  - `ExpenseFilters = { from: string | null; to: string | null; categoryId: string | null; clientId: string | null; projectId: string | null; missingReceipt: boolean }`
  - `ExpenseRow = { id; spentOn; categoryId; categoryName; payee; amount: string; clientId: string | null; clientName: string | null; projectId: string | null; projectName: string | null; receiptCount: number }`
  - `ExpenseDetail = ExpenseRow & { notes: string | null; attachments: { id; fileName; mimeType; sizeBytes }[] }`
  - `listExpenses(db, firmId, filters, page = 1)`:
    - 50 per page, ordered `spent_on desc, created_at desc`.
    - Returns `{ rows: ExpenseRow[]; total: string; count: number; pages: number }`.
    - `total` and `count` come from `expense_totals`.
    - `missingReceipt` filtering matches the SQL function.
  - `getExpense(db, firmId, id)`
  - `createExpense(db, firmId, input: ExpenseInput)` returns `{ id }`.
  - `updateExpense(db, firmId, id, input)`
  - `deleteExpense(db, firmId, id)`: deletes the row (RLS), then calls `removeOwnerFolder` for the expense.
  - `ExpenseInput = { spentOn; categoryId; payee; amount: string; clientId: string | null; projectId: string | null; notes: string | null }`
- **`schemas.ts`:**
  - `expenseInputSchema`:
    - `amount` via `parseMoney` and > 0, with the existing upper-bound pattern 'Amount is too large.'
    - `spentOn` is ISO and not in the future
    - `payee` is 1–200 characters
    - `notes` is ≤ 1000 characters
    - `categoryId` is required ('Choose a category.')
    - ids are UUIDs or empty, and empty becomes null
  - `categoryNameSchema`: trimmed, 1–60 characters.
- **Actions:**
  - All actions use `requireFirmRole(firmId, ['admin','manager'])` and revalidate `/f/{firmId}/expenses` (and the detail page).
  - `createExpenseAction` redirects to `/f/{firmId}/expenses/{id}?added=1` on success.
  - Receipts: `createExpenseUploadTargetsAction(firmId, expenseId, files)` and `finalizeExpenseUploadsAction(firmId, expenseId, items)` call the shared module. `deleteExpenseAttachmentAction` is also provided.
  - Category actions: `createCategoryAction`, `renameCategoryAction`, `setCategoryActiveAction`, `deleteCategoryAction`.

- [ ] **Step 1: Write failing integration tests:**
  - Create, then get, then list, and the totals are strings.
  - **Filters (Review Focus 5):**
    - 5 expenses across 2 categories, 2 clients and 3 dates, one with a receipt (uploaded and finalized via the shared module).
    - Each single filter returns the right rows and totals.
    - The combination category + client + from/to + missingReceipt returns exactly one row with an exact total.
  - **Paging:** 55 expenses inserted via adminDb give `pages: 2`, page 2 has 5 rows, and the total covers all 55.
  - **Project sets the client:** `updateExpense` with a project from another client stores that project's client (exercising the trigger through the data layer).
  - **Deleting an expense:** `deleteExpense` removes its stored receipt object, checked by listing the folder via the service role.
  - **Categories:**
    - `listCategories` returns `expenseCount`.
    - Renaming to a duplicate gives the mapped message.
    - Retiring, then trying to create an expense with that category, gives the mapped message.
    - Deleting a used category gives the mapped message.
  - **Cross-firm:** a dual-firm manager calling `getExpense(db, firmA, expenseOfB)` gets `'Expense not found.'`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npm run test:int` and `npm run test:unit` → PASS. Lint and typecheck must be clean.
- [ ] **Step 5: Commit** `feat(expenses): expenses and categories data modules and actions`

---

### Task 4: Expense pages and categories page

**Files:**
- Create:
  - `src/app/f/[firmId]/expenses/page.tsx`
  - `expenses/new/page.tsx`
  - `expenses/[id]/page.tsx`
  - `expenses/expense-form.tsx`
  - `expenses/categories/page.tsx`
  - `expenses/categories/category-forms.tsx`
  - `src/components/attachments/upload-files.ts` (moved from `invoices/[id]/upload-files.ts`, generalised over the two actions)
  - `src/components/attachments/file-list.tsx`
- Modify:
  - `src/app/f/[firmId]/layout.tsx`: nav `Expenses` → `/expenses`, admin/manager, after `Unpaid`
  - `src/app/f/[firmId]/invoices/[id]/payments-section.tsx`: use the shared upload and file-list pieces, with no behaviour change
- Test: `tests/e2e/expenses.spec.ts` (plus the existing `payments` e2e stays green)

**Interfaces:**
- **`/expenses`** (admin/manager; others get a 404):
  - **Filter form** (GET): `From`, `To` (default: first and last day of the current month), `Category`, `Client`, `Project` (all optional, with "All …" options), and a `No receipt only` checkbox.
  - **Summary line:** `{count} expenses · {formatMoney(total)}`.
  - **Table:**
    - Columns: Date, Payee, Category (with a "(retired)" suffix if inactive), Client, Project, Amount, Receipt.
    - The Receipt column shows the count, or a `No receipt` marker in amber text with the words.
    - Each row links to `/expenses/{id}`.
  - Pagination links show only when `pages > 1`.
  - Buttons: `New expense`, `Categories`.
  - Empty state: `"No expenses match these filters."`
- **Expense form** (new and edit):
  - Fields: `Date` (default today), `Category` (active categories only; on edit the current retired one is also shown and marked retired), `Payee`, `Amount` (`type="text" inputMode="decimal"`), `Client` (optional), `Project` (optional; options grouped by client), `Notes`.
  - Note under Project: `"The client is set from the project."`
  - Field errors appear under each field. The action error goes in `role="alert"`.
- **`/expenses/new`:** the form, plus a `Receipts` file input. After the create, files are uploaded through the shared signed-upload helper, and the page then redirects to the detail page. A file warning is shown on the detail page via `?fileWarning=` or session state, at the implementer's choice.
- **`/expenses/{id}`:**
  - The edit form, then a `Receipts` section using the shared file list with Remove (confirm) and an `Add receipts` input.
  - `Delete expense` with the confirm `Delete this expense of {amount}? Its receipts are deleted too.`
- **`/expenses/categories`** (admin/manager):
  - A table of Name, Status (Active/Retired) and number of expenses.
  - Row actions: `Rename` (inline), `Retire` or `Restore`, and `Delete` (only when the expense count is 0, with confirm).
  - An `Add category` form.

- [ ] **Step 1: Write failing e2e tests:**
  - **Manager records an expense with a receipt:**
    - Go to `Expenses`, then `New expense`. Pick category Travel, payee `Skyline Air`, amount `412.37`, client Globex, attach `remittance.pdf`, and save.
    - The detail page shows the receipt link, and the download returns 200 with a PDF.
    - The list shows the row with `$412.37` and receipt count 1.
  - **Project sets the client:** choosing project `Portal` of client Globex while client Initech is selected saves with Globex.
  - **No receipt filter:** an expense without a receipt shows `No receipt`. Ticking `No receipt only` lists only it, and the summary shows its amount.
  - **Categories:**
    - Add `Meals`. Adding ` meals ` shows the duplicate message.
    - Retire `Meals`. It is no longer offered on the New expense form.
    - Restore it.
    - Delete is not offered for Travel once Travel has an expense.
  - **Delete an expense:** after confirming, it's gone from the list.
  - **Consultant blocked:** a consultant gets a 404 on `/expenses` and on `/expenses/categories`.
- [ ] **Step 2:** Run `npm run test:e2e -- expenses` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `expenses` and `payments` e2e → PASS.
- [ ] **Step 5: Commit** `feat(expenses): expense list, entry and receipts; category management`

---

### Task 5: README and full gate

**Files:**
- Modify: `README.md`
- Test: full suite

**Interfaces:**
- README "Expenses" section:
  - who can do what
  - one tax-inclusive amount
  - the client follows the project
  - categories (defaults, unique names, retire and restore, delete only when unused)
  - receipts optional and flagged
  - the file rules
  - the totals in the list
- README "File storage" note: files are uploaded straight to storage under a holding name and checked by the server, which then moves them. Users can't overwrite or delete stored files outside the app. Abandoned uploads are swept after a day.

- [ ] **Step 1:** Write the README sections.
- [ ] **Step 2:** Run the full gate after `npm run db:reset`, with nothing on port 3000: `npm run lint && npm run typecheck && npm run test:unit && npm run test:int && npm run test:e2e && npm run build`. Expect all PASS.
- [ ] **Step 3: Commit** `docs: expenses and file storage`
