import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { adminDb, newFirm, TEST_PASSWORD } from '../integration/helpers'
import { todayIso } from '../../src/lib/domain/dates'
import { addDays } from '../../src/lib/domain/weeks'
import { issueManualInvoice } from '../integration/invoice-fixtures'

const REMITTANCE = path.join(__dirname, 'fixtures', 'remittance.pdf')
const FAKE = path.join(__dirname, 'fixtures', 'fake.pdf')

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function setup(name: string, amount = '1234.56') {
  const f = await newFirm(name)
  const inv = await issueManualInvoice(f, amount)
  return { f, ...inv }
}

async function open(page: Page, f: Awaited<ReturnType<typeof newFirm>>, invoiceId: string) {
  await login(page, f.manager.email)
  await page.goto(`/f/${f.firmId}/invoices/${invoiceId}`)
}

const form = (page: Page) => page.getByRole('form', { name: 'Record payment' })

async function record(page: Page, amount: string, extra: { reference?: string; file?: string } = {}) {
  const fm = form(page)
  await fm.getByLabel('Amount').fill(amount)
  await fm.getByLabel('Method').selectOption({ label: 'Bank transfer' })
  if (extra.reference) await fm.getByLabel('Reference').fill(extra.reference)
  if (extra.file) await fm.getByLabel('Files').setInputFiles(extra.file)
  await fm.getByRole('button', { name: 'Record payment' }).click()
}

test('partial payment with a file, then pay the rest', async ({ page }) => {
  const { f, invoiceId } = await setup('Pay Partial Firm')
  await open(page, f, invoiceId)
  await expect(page.getByTestId('balance-due')).toHaveText('$1,234.56')
  await expect(form(page).getByLabel('Amount')).toHaveValue('1234.56')

  await record(page, '500.00', { reference: 'TRX-881', file: REMITTANCE })
  await expect(page.getByTestId('status')).toHaveText('Partly paid')
  await expect(page.getByTestId('balance-due')).toHaveText('$734.56')
  const row = page.getByRole('row', { name: /TRX-881/ })
  await expect(row).toBeVisible()
  const link = row.getByRole('link', { name: 'remittance.pdf' })
  await expect(link).toBeVisible()
  const href = await link.getAttribute('href')
  const res = await page.request.get(href!)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('application/pdf')

  await expect(form(page).getByLabel('Amount')).toHaveValue('734.56')
  await record(page, '734.56')
  await expect(page.getByTestId('status')).toHaveText('Paid')
  await expect(form(page)).toHaveCount(0)
})

test('overpayment is refused', async ({ page }) => {
  const { f, invoiceId } = await setup('Pay Over Firm', '777.77')
  await open(page, f, invoiceId)
  await record(page, '2000')
  await expect(page.getByText('This payment is more than the balance due.')).toBeVisible()
  await expect(page.getByTestId('status')).toHaveText('Issued')
})

test('a disguised file is rejected with a warning but the payment is recorded', async ({ page }) => {
  const { f, invoiceId } = await setup('Pay Fake Firm', '555.55')
  await open(page, f, invoiceId)
  await record(page, '100.00', { reference: 'TRX-FAKE', file: FAKE })
  await expect(page.getByTestId('status')).toHaveText('Partly paid')
  await expect(page.getByRole('status').filter({ hasText: 'fake.pdf' })).toBeVisible()
  await expect(page.getByRole('row', { name: /TRX-FAKE/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'fake.pdf' })).toHaveCount(0)
})

test('the file warning survives a payment that completes the invoice', async ({ page }) => {
  const { f, invoiceId } = await setup('Pay Full Fake Firm', '666.66')
  await open(page, f, invoiceId)
  await record(page, '666.66', { reference: 'TRX-FULL', file: FAKE })
  await expect(page.getByTestId('status')).toHaveText('Paid')
  await expect(form(page)).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'fake.pdf' })).toBeVisible()
  await expect(page.getByRole('row', { name: /TRX-FULL/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'fake.pdf' })).toHaveCount(0)
})

test('edit and delete a payment', async ({ page }) => {
  const { f, invoiceId } = await setup('Pay Edit Firm', '888.88')
  await open(page, f, invoiceId)
  await record(page, '500.00', { reference: 'TRX-881' })
  await expect(page.getByTestId('status')).toHaveText('Partly paid')
  await record(page, '100.00', { reference: 'KEEP-1' })
  await expect(page.getByRole('row', { name: /KEEP-1/ })).toBeVisible()

  await page.getByRole('row', { name: /TRX-881/ }).getByRole('button', { name: 'Edit' }).click()
  const edit = page.getByRole('form', { name: 'Edit payment' })
  await edit.getByLabel('Reference').fill('TRX-882')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('row', { name: /TRX-882/ })).toBeVisible()

  let message = ''
  page.once('dialog', (d) => {
    message = d.message()
    void d.accept()
  })
  await page.getByRole('row', { name: /TRX-882/ }).getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('row', { name: /TRX-882/ })).toHaveCount(0)
  expect(message).toBe('Delete this payment of $500.00? Its files are deleted too.')
  await expect(page.getByTestId('balance-due')).toHaveText('$788.88')
})

test('remove an attached file while editing', async ({ page }) => {
  const { f, invoiceId } = await setup('Pay Remove Firm', '321.00')
  await open(page, f, invoiceId)
  await record(page, '21.00', { reference: 'TRX-RM', file: REMITTANCE })
  const row = page.getByRole('row', { name: /TRX-RM/ })
  await expect(row.getByRole('link', { name: 'remittance.pdf' })).toBeVisible()
  await row.getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('form', { name: 'Edit payment' }).getByRole('button', { name: 'Remove remittance.pdf' }).click()
  await expect(page.getByRole('link', { name: 'remittance.pdf' })).toHaveCount(0)
})

test('consultant cannot download an attachment', async ({ page, browser, baseURL }) => {
  const { f, invoiceId } = await setup('Pay Block Firm', '444.44')
  await open(page, f, invoiceId)
  await record(page, '44.00', { reference: 'TRX-BLK', file: REMITTANCE })
  await expect(page.getByRole('link', { name: 'remittance.pdf' })).toBeVisible()
  const { data } = await adminDb().from('attachments').select('id').eq('firm_id', f.firmId).single()
  const ctx = await browser.newContext({ baseURL })
  const cPage = await ctx.newPage()
  await login(cPage, f.consultant.email)
  const res = await cPage.request.get(`/f/${f.firmId}/attachments/${data!.id}`)
  expect(res.status()).toBe(404)
  await ctx.close()
})

test('unpaid invoices page shows ageing and filters by client', async ({ page }) => {
  const f = await newFirm('Unpaid Firm')
  const old = await issueManualInvoice(f, '1111.11')
  const other = await issueManualInvoice(f, '222.22')
  await issueManualInvoice(f, '333.33')
  const due = addDays(todayIso(), -45)
  const { error } = await adminDb().from('invoices').update({ issue_date: due, due_date: due }).eq('id', old.invoiceId)
  expect(error).toBeNull()
  await login(page, f.manager.email)
  await page.getByRole('link', { name: 'Unpaid', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Unpaid invoices' })).toBeVisible()
  await expect(page.getByText('Overdue by 45 days')).toBeVisible()
  await expect(page.getByTestId('ageing-d31_60')).toContainText('$1,111.11')
  await expect(page.getByTestId('ageing-d31_60')).toContainText('31–60 days')
  await expect(page.getByRole('link', { name: 'Record payment' })).toHaveCount(3)

  await page.getByLabel('Client').selectOption(other.clientId)
  await page.getByRole('button', { name: 'Filter' }).click()
  await expect(page).toHaveURL(new RegExp(`client=${other.clientId}`))
  await expect(page.getByText('Overdue by 45 days')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Record payment' })).toHaveCount(1)
})

test('manager dashboard shows outstanding total', async ({ page }) => {
  const f = await newFirm('Dash Outstanding Firm')
  await issueManualInvoice(f, '1000.01')
  await issueManualInvoice(f, '2000.02')
  await login(page, f.manager.email)
  await page.goto(`/f/${f.firmId}`)
  await expect(page.getByTestId('outstanding')).toContainText('$3,000.03')
  await expect(page.getByTestId('overdue')).toContainText('$0.00')
})
