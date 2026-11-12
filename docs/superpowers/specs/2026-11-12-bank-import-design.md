# Bank statement import: design

Status: draft for review, 2026-11-12

## Purpose

Firms download transactions from their bank and credit-card accounts and load
them into the app. Each line is then turned into a payment against an invoice,
an expense, other income, a link to something already entered, or ignored. The
result is that the Transactions report (and its accountant CSV) reflects what
actually went through the bank, without re-typing and without duplicates.

Decisions already made with the product owner:

- Matching **suggests, the user confirms**. Nothing is recorded from an import
  until someone clicks Confirm.
- A firm can have **several accounts**, each a **Bank** or **Credit card** account.
- Deposits that aren't invoice payments become **Other income**, a new kind of
  transaction with its own categories, shown in the Transactions report.
- First version reads **OFX/QFX and CSV** (CSV with a saved column mapping per account).

Out of scope for this version: PDF statements, live bank feeds (e.g. Plaid),
splitting one bank line across several invoices or expenses, running-balance
reconciliation, multiple currencies (the firm's currency is assumed).

## Who can use it

Admins and managers only, like Billing and Reports. Consultants see nothing.
All reads and writes go through security-definer functions that check
`has_role(firm, {admin,manager})`, as the rest of the billing code does, and
every table has RLS limited to the firm.

## Data model

**bank_accounts**: id, firm_id, name (1–60 chars, unique per firm), kind
(`bank` | `credit_card`), last4 (optional, 4 digits), csv_mapping (jsonb, null
until the first CSV import), active, timestamps.

**bank_imports**: one row per uploaded file. id, firm_id, account_id,
file_name, format (`ofx` | `csv`), line_count, duplicate_count, imported_at,
imported_by. The file itself is not kept; the lines are.

**bank_lines**: id, firm_id, account_id, import_id, posted_on (date), amount
(numeric(12,2), signed: + money in, − money out, never 0), description (text),
bank_ref (the OFX FITID when there is one), dedupe_key, status
(`new` | `done` | `ignored`), ignore_reason (optional), and at most one link:
payment_id, expense_id or other_income_id.
- Unique (account_id, dedupe_key), so the same line can never be stored twice.
- Checks: status `done` ⇔ exactly one link is set; `ignored` ⇔ no link;
  `new` ⇔ no link and no ignore reason.
- A payment, expense or other-income row can be linked by at most one bank line
  (unique partial indexes).
- If the linked payment/expense/other income is deleted elsewhere in the app,
  the line goes back to `new` (FK `on delete set null` plus a trigger that resets
  the status).

**other_income_categories**: same shape and rules as expense_categories. Each
new firm gets Interest, Refund, Owner contribution and Other; existing firms
get them in the migration.

**other_income**: id, firm_id, received_on, category_id, source (who paid,
1–120 chars), amount (> 0), notes, timestamps. Created from a bank line or by
hand on its own page.

## Reading files

Parsing happens on the server in TypeScript, in `src/modules/bank/`. Limits:
4 MB per file (Vercel caps a request at 4.5 MB), 5,000 lines per file.

**OFX/QFX**: both the older SGML style and the XML style. Read each
`STMTTRN` block: DTPOSTED (date), TRNAMT (signed amount), FITID (bank_ref),
NAME and MEMO (joined into description). dedupe_key = `fitid:<FITID>`.

**CSV**: the first CSV upload for an account asks for a mapping, shown with a
preview of the first rows:
- which column is the date, and the date format (YYYY-MM-DD, MM/DD/YYYY or DD/MM/YYYY)
- which column is the description
- amount as either one signed column (with a "flip signs" option, since some
  card exports show purchases as positive) or separate Money in / Money out columns

The mapping is saved on the account and reused, and can be changed at any time.
dedupe_key = hash of date | amount | normalised description | n, where n counts
identical lines within the same file (1, 2, …). So two identical coffees on the
same day both import, but uploading the same or an overlapping file again adds nothing.

After an upload the user sees "N new lines, M already imported", and lines
that can't be read are listed with their row number and reason. Nothing is
stored when the file can't be read at all.

## Review screen

**Billing › Bank accounts** lists accounts with their count of lines to review.
Opening an account shows Upload and the review list, with **New** lines first and
filters for Done and Ignored. Each new line has one primary action, based on the
direction of the money:

**Money in (+)**
- **Invoice payment**: suggestions are open invoices (issued or partly paid)
  whose balance due equals the amount; invoices whose client name appears in the
  description rank first. The user can also pick any open invoice when the amount
  is a part payment (amount ≤ balance due). Confirm calls the existing payment
  recording logic: date = posted_on, method = bank transfer (card for a
  credit-card account), reference = bank_ref or the description (cut to fit),
  and notes as typed.
- **Other income**: category, source (defaults to the cleaned description) and notes.

**Money out (−)**
- **Expense**: payee (defaults to the cleaned description), category, optional
  client/project, and notes. The category is suggested from the last confirmed
  line with the same cleaned description ("AWS" → Software).

**Either direction**
- **Already entered**: link to an existing payment or expense with the same amount,
  dated within 7 days, that no bank line links to yet. These are suggested first
  when they exist, so manual entries aren't doubled.
- **Ignore**, with an optional reason (transfer between accounts, card repayment, …).
- **Undo** on Done or Ignored lines puts the line back to New. It unlinks only and
  never deletes the payment or expense. Deleting those stays on their own pages.

Bulk: tick several money-out lines that all have a category suggestion and
click "Confirm suggested", or tick any lines and click "Ignore".

Each confirm is one database function, so the line and the record it creates
change together or not at all. A line that someone else has just handled
returns "This line was already handled", and the page refreshes.

## Reports

The Transactions report gains Other income rows: "Other income – <source>",
the category name, a positive amount, and the notes. Money in includes them.
Nothing else changes, because confirmed bank lines simply become payments,
expenses and other income.

## Menu

Billing: Invoices, Unpaid invoices, Payments, Expenses, **Other income**,
**Bank accounts**. Other income categories are managed from the Other income
page, the same way expense categories are.

## Errors and edge cases

- An upload to an inactive account is refused. Accounts with lines can't be
  deleted, only deactivated.
- An amount of zero or a date that doesn't match the mapped format: that row is
  skipped and reported, and the rest still import.
- An invoice voided or fully paid after it was suggested: Confirm fails with
  the usual payment error and the line stays New.
- Text from the file (description, payee) is treated as untrusted. It's stored
  as text, rendered escaped, and guarded against spreadsheet formulas in the CSV export.

## Testing

- **Unit**: OFX SGML and XML parsing (including a real-world QFX sample), CSV
  mapping (signed column, flipped signs, in/out columns, three date formats,
  quoted fields, bad rows), dedupe keys (repeats within a file, re-uploads),
  description cleaning, and the suggestion ranking.
- **Integration**: RLS and role checks on every table and function; duplicate
  protection; each confirm function including the race where two users handle
  the same line; the one-link rules; deleting a payment or expense resets its
  line; Other income appearing in the Transactions report.
- **End-to-end**: create an account, upload an OFX file, confirm an invoice
  payment, an expense and other income, ignore a line, upload the same file again
  and see no new lines, map and upload a CSV, and download the Transactions CSV.
