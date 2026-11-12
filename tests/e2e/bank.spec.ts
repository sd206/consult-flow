import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { answerConfirm } from './confirm'
import { goTo } from './nav'
import { adminDb, newFirm, TEST_PASSWORD } from '../integration/helpers'
import { issueManualInvoice } from '../integration/invoice-fixtures'

const FIXTURES = path.resolve(__dirname, '../fixtures/bank')

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function addAccount(page: Page, firmId: string, name: string, kind: 'Bank' | 'Credit card') {
  await page.goto(`/f/${firmId}/bank`)
  await page.getByRole('link', { name: 'Add account' }).click()
  await page.getByLabel('Account name').fill(name)
  await page.getByLabel('Type').selectOption({ label: kind })
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(name) })).toBeVisible()
}

async function upload(page: Page, file: string) {
  await page.getByLabel('Statement file').setInputFiles(path.join(FIXTURES, file))
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
}

const row = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text }).first()

test('import a statement, review each line, and re-upload without duplicates', async ({ page }) => {
  const f = await newFirm('Bank E2E Firm')
  const inv = await issueManualInvoice(f, 1500)
  await login(page, f.manager.email)
  await page.goto(`/f/${f.firmId}`)
  await goTo(page, 'Billing', 'Bank accounts')
  await expect(page).toHaveURL(/\/bank$/)
  await addAccount(page, f.firmId, 'Main checking', 'Bank')

  await upload(page, 'sample-sgml.qfx')
  await expect(page.getByRole('status')).toContainText('3 new lines, 0 already imported')

  // Deposit -> the suggested invoice.
  await page.getByRole('button', { name: /^Review GLOBEX CORP PAYMENT/ }).click()
  const payForm = page.getByRole('form', { name: 'Invoice payment' })
  await expect(payForm.getByLabel('Invoice')).toBeVisible()
  await payForm.getByRole('button', { name: 'Confirm payment' }).click()
  await expect(page.getByRole('button', { name: /^Review GLOBEX CORP PAYMENT/ })).toHaveCount(0)

  // Card charge -> expense with a category.
  await page.getByRole('button', { name: /^Review AWS EMEA/ }).click()
  const expForm = page.getByRole('form', { name: 'Expense' })
  await expForm.getByLabel('Category').selectOption({ label: 'Software' })
  await expForm.getByRole('button', { name: 'Confirm expense' }).click()
  await expect(page.getByRole('button', { name: /^Review AWS EMEA/ })).toHaveCount(0)

  // Transfer -> ignored with a reason.
  await page.getByRole('button', { name: /^Review TRANSFER TO SAVINGS/ }).click()
  await page.getByRole('radio', { name: 'Ignore' }).check()
  await page.getByLabel('Reason (optional)').fill('Transfer')
  await page.getByRole('button', { name: 'Ignore line' }).click()
  await expect(page.getByText('Nothing to review.')).toBeVisible()

  // The same file again adds nothing.
  await upload(page, 'sample-sgml.qfx')
  await expect(page.getByRole('status')).toContainText('0 new lines, 3 already imported')

  await page.getByRole('link', { name: 'Done' }).click()
  await expect(row(page, 'GLOBEX CORP PAYMENT')).toContainText('Invoice payment')
  await expect(row(page, 'AWS EMEA')).toContainText('Expense – AWS EMEA')
  await page.getByRole('link', { name: 'Ignored' }).click()
  await expect(row(page, 'TRANSFER TO SAVINGS')).toContainText('Transfer')

  // Undo puts the line back to review.
  await row(page, 'TRANSFER TO SAVINGS').getByRole('button', { name: /^Undo/ }).click()
  await answerConfirm(page)
  await expect(page.getByText('No lines here yet.')).toBeVisible()

  await page.goto(`/f/${f.firmId}/invoices/${inv.invoiceId}`)
  await expect(page.getByTestId('status')).toHaveText('Paid')
  await page.goto(`/f/${f.firmId}/expenses`)
  await expect(page.getByRole('row', { name: /AWS EMEA/ })).toBeVisible()
})

test('map a credit-card CSV with flipped signs', async ({ page }) => {
  const f = await newFirm('Bank CSV Firm')
  await login(page, f.manager.email)
  await addAccount(page, f.firmId, 'Amex', 'Credit card')

  await upload(page, 'card-positive.csv')
  const mapping = page.getByRole('form', { name: 'CSV columns' })
  await expect(mapping).toBeVisible()
  await expect(mapping.getByLabel('Amount column')).toHaveValue('2')
  await mapping.getByLabel('Flip signs (purchases shown as positive)').check()
  await mapping.getByRole('button', { name: 'Import with these columns' }).click()
  await expect(page.getByRole('status')).toContainText('4 new lines, 0 already imported')
  await expect(row(page, 'DELTA AIR LINES')).toContainText('-$412.37')
  await expect(row(page, 'PAYMENT THANK YOU')).toContainText('$800.00')

  // The mapping is remembered: the same file imports straight away, as duplicates.
  await upload(page, 'card-positive.csv')
  await expect(page.getByRole('status')).toContainText('0 new lines, 4 already imported')
})

test('a consultant cannot open bank accounts', async ({ page }) => {
  const f = await newFirm('Bank Access Firm')
  await login(page, f.consultant.email)
  const res = await page.goto(`/f/${f.firmId}/bank`)
  expect(res?.status()).toBe(404)
})

test('a deposit recorded as other income shows on the Transactions report', async ({ page }) => {
  const f = await newFirm('Bank Income Firm')
  await login(page, f.manager.email)
  await addAccount(page, f.firmId, 'Savings', 'Bank')

  await upload(page, 'inout.csv')
  const mapping = page.getByRole('form', { name: 'CSV columns' })
  await mapping.getByLabel('Date format').selectOption('DMY')
  await expect(mapping.getByLabel('Amounts')).toHaveValue('inout')
  await mapping.getByRole('button', { name: 'Import with these columns' }).click()
  await expect(page.getByRole('status')).toContainText('2 new lines, 0 already imported')
  await expect(page.getByRole('status')).toContainText("Row 5: The date doesn't match the chosen format.")

  await page.getByRole('button', { name: /^Review Interest paid/ }).click()
  await page.getByRole('radio', { name: 'Other income' }).check()
  const form = page.getByRole('form', { name: 'Other income' })
  await expect(form.getByLabel('Received from')).toHaveValue('INTEREST PAID')
  await form.getByLabel('Category').selectOption({ label: 'Interest' })
  await form.getByLabel('Notes (optional)').fill('November interest')
  await form.getByRole('button', { name: 'Confirm other income' }).click()
  await expect(page.getByRole('button', { name: /^Review Interest paid/ })).toHaveCount(0)

  await goTo(page, 'Billing', 'Other income')
  await expect(page.getByRole('row', { name: /INTEREST PAID/ })).toContainText('$1,234.50')

  await goTo(page, 'Reports', 'Transactions')
  const txn = page.getByRole('row', { name: /Other income – INTEREST PAID/ })
  await expect(txn).toContainText('Interest')
  await expect(txn).toContainText('$1,234.50')
  await expect(txn).toContainText('November interest')
})

test('a statement between 3 MB and 5 MB uploads', async ({ page }) => {
  const f = await newFirm('Bank Big File Firm')
  await login(page, f.manager.email)
  await addAccount(page, f.firmId, 'Busy checking', 'Bank')
  const memo = 'M'.repeat(4000)
  const txns = Array.from(
    { length: 1000 },
    (_, i) => `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261102<TRNAMT>-1.00<FITID>BIG${i}<NAME>VENDOR ${i}<MEMO>${memo}</STMTTRN>`,
  ).join('\n')
  const body = `OFXHEADER:100\nDATA:OFXSGML\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n${txns}\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>\n`
  expect(body.length).toBeGreaterThan(3.5 * 1024 * 1024)
  await page.getByLabel('Statement file').setInputFiles({ name: 'big.qfx', mimeType: 'application/x-ofx', buffer: Buffer.from(body) })
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('1000 new lines, 0 already imported', { timeout: 30000 })
})

test('bulk: filter and categorise, mark duplicates, mixed in and out', async ({ page }) => {
  const f = await newFirm('Bank Bulk E2E Firm')
  const db = adminDb()
  const { data: travel } = await db.from('expense_categories').select('id').eq('firm_id', f.firmId).eq('name', 'Travel').single()
  await db.from('expenses').insert({ firm_id: f.firmId, spent_on: '2026-11-01', category_id: travel!.id, payee: 'Delta', amount: '412.37' })
  await login(page, f.manager.email)
  await addAccount(page, f.firmId, 'Amex', 'Credit card')
  await upload(page, 'card-positive.csv')
  const mapping = page.getByRole('form', { name: 'CSV columns' })
  await mapping.getByLabel('Flip signs (purchases shown as positive)').check()
  await mapping.getByRole('button', { name: 'Import with these columns' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'new lines' })).toContainText('4 new lines')

  // Filter to the two Uber rides, select all shown, and categorise them together.
  await page.getByLabel('Filter', { exact: true }).fill('uber')
  await expect(page.getByText('Showing 2 of 4')).toBeVisible()
  await page.getByLabel('Select all shown').check()
  await page.getByLabel('Expense category').selectOption({ label: 'Travel' })
  await page.getByRole('button', { name: 'Categorise selected' }).click()
  expect(await answerConfirm(page)).toBe('Record 2 lines as expenses in Travel?')
  await expect(page.getByRole('status', { name: 'Bulk result' })).toHaveText('2 lines recorded.')

  // Delta matches the expense entered by hand; the card payment has no match and is ignored.
  await page.getByLabel('Filter', { exact: true }).fill('')
  await expect(page.getByText('Showing 2 of 2')).toBeVisible()
  await page.getByLabel('Select all shown').check()
  await page.getByRole('button', { name: 'Mark as duplicate' }).click()
  await answerConfirm(page)
  await expect(page.getByRole('status', { name: 'Bulk result' })).toHaveText(
    '1 line matched to existing entries, 1 line ignored as duplicates.',
  )
  await expect(page.getByText('Nothing to review.')).toBeVisible()

  await page.getByRole('link', { name: 'Done' }).click()
  await expect(row(page, 'DELTA AIR LINES')).toContainText('Expense – Delta')
  await expect(page.getByRole('row').filter({ hasText: 'UBER' }).first()).toContainText('Expense – UBER *TRIP HELP.UBER.COM')
  await page.getByRole('link', { name: 'Ignored' }).click()
  await expect(row(page, 'PAYMENT THANK YOU')).toContainText('Duplicate')
})

test('bulk: money in and money out categorised in one go', async ({ page }) => {
  const f = await newFirm('Bank Bulk Mixed Firm')
  await login(page, f.manager.email)
  await addAccount(page, f.firmId, 'Savings', 'Bank')
  await upload(page, 'inout.csv')
  const mapping = page.getByRole('form', { name: 'CSV columns' })
  await mapping.getByLabel('Date format').selectOption('DMY')
  await mapping.getByRole('button', { name: 'Import with these columns' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'new lines' })).toContainText('2 new lines')

  await page.getByLabel('Select all shown').check()
  await expect(page.getByRole('group', { name: 'Bulk actions' })).toContainText('2 selected')
  await expect(page.getByRole('button', { name: 'Categorise selected' })).toBeDisabled()
  await page.getByLabel('Expense category').selectOption({ label: 'Office' })
  await page.getByLabel('Other income category').selectOption({ label: 'Interest' })
  await page.getByRole('button', { name: 'Categorise selected' }).click()
  expect(await answerConfirm(page)).toBe('Record 1 line as expenses in Office and 1 line as other income in Interest?')
  await expect(page.getByRole('status', { name: 'Bulk result' })).toHaveText('2 lines recorded.')
  await page.goto(`/f/${f.firmId}/other-income`)
  await expect(page.getByRole('row', { name: /INTEREST PAID/ })).toContainText('Interest')
})

test('record an invoice payment from an imported deposit', async ({ page }) => {
  const f = await newFirm('Bank Deposit Invoice Firm')
  const inv = await issueManualInvoice(f, 1500)
  await login(page, f.manager.email)
  await addAccount(page, f.firmId, 'Main checking', 'Bank')
  await upload(page, 'sample-sgml.qfx')
  await expect(page.getByRole('status')).toContainText('3 new lines')

  await page.goto(`/f/${f.firmId}/invoices/${inv.invoiceId}`)
  // The invoice page itself no longer holds the deposits; Record payment opens them.
  await expect(page.getByRole('region', { name: 'Deposits from your bank' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Record payment', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Deposits from your bank' })
  const deposit = panel.getByRole('row', { name: /GLOBEX CORP PAYMENT/ })
  await expect(deposit).toContainText('Exact balance')
  await expect(deposit).toContainText('$1,500.00')
  await expect(panel.getByRole('row', { name: /AWS EMEA/ })).toHaveCount(0)
  await panel.getByLabel('Notes for the payment (optional)').fill('Paid by ACH')
  await deposit.getByRole('button', { name: /^Record this payment/ }).click()
  expect(await answerConfirm(page)).toMatch(/^Record \$1,500\.00 from Main checking on 2 Nov as a payment on /)
  // Back on the invoice, now paid, with no Record payment button.
  await expect(page.getByTestId('status-badge')).toHaveText('Paid')
  await expect(page.getByRole('link', { name: 'Record payment', exact: true })).toHaveCount(0)

  await page.goto(`/f/${f.firmId}/bank`)
  await page.getByRole('link', { name: 'Main checking' }).click()
  await page.getByRole('link', { name: 'Done' }).click()
  await expect(row(page, 'GLOBEX CORP PAYMENT')).toContainText('Invoice payment')
})
