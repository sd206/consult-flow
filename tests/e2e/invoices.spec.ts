import { test, expect, type Page } from '@playwright/test'
import { adminDb, newFirm, TEST_PASSWORD } from '../integration/helpers'
import { seedApprovedHours } from '../integration/invoice-fixtures'

type Firm = Awaited<ReturnType<typeof newFirm>>

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function seed(name: string) {
  const f = await newFirm(name)
  const { error } = await adminDb()
    .from('firms')
    .update({ invoice_number_pattern: 'ACME-{YYYY}-{SEQ:4}' })
    .eq('id', f.firmId)
  if (error) throw new Error(error.message)
  await seedApprovedHours(f, {
    clientName: 'Acme Corp',
    entries: [
      { workDate: '2026-10-05', hours: '8', note: 'Discovery' },
      { workDate: '2026-10-06', hours: '7.5', note: 'Workshop' },
    ],
  })
  return f
}

async function findHours(page: Page) {
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Acme Corp' })
  await page.getByLabel('Period start').fill('2026-10-01')
  await page.getByLabel('Period end').fill('2026-10-31')
  await page.getByRole('button', { name: 'Find hours' }).click()
}

async function buildDraft(page: Page, f: Firm) {
  await login(page, f.manager.email)
  await page.goto(`/f/${f.firmId}`)
  await page.getByRole('link', { name: 'Invoices' }).click()
  await page.getByRole('link', { name: 'New invoice' }).click()
  await findHours(page)
  await expect(page.getByRole('cell', { name: '15.50' })).toBeVisible()
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page.getByRole('heading', { name: 'Draft invoice' })).toBeVisible()
}

async function issue(page: Page) {
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Issue invoice' }).click()
  await expect(page.getByTestId('status')).toHaveText('Issued')
}

test('manager builds, edits and issues an invoice', async ({ page }) => {
  const f = await seed('Invoice Build Firm')
  await buildDraft(page, f)

  await expect(page.getByRole('cell', { name: '$2,066.62' })).toBeVisible()
  await expect(page.getByLabel('Line description Con Sultant Rollout')).toHaveValue('Discovery; Workshop')

  await page.getByLabel('Description', { exact: true }).fill('Setup fee')
  await page.getByLabel('Quantity', { exact: true }).fill('1')
  await page.getByLabel('Unit price', { exact: true }).fill('250')
  await page.getByRole('button', { name: 'Add line' }).click()
  await expect(page.getByTestId('total')).toContainText('2,316.62')

  await page.getByLabel('Discount', { exact: true }).selectOption({ label: 'Percentage' })
  await page.getByLabel('Discount value').fill('10')
  await page.getByLabel('Discount label').fill('Loyalty')
  await page.getByRole('button', { name: 'Save discount' }).click()
  await expect(page.getByTestId('discount')).toContainText('231.66')
  await expect(page.getByTestId('total')).toContainText('2,084.96')

  await issue(page)
  const year = new Date().getUTCFullYear()
  await expect(page.getByRole('heading', { name: `ACME-${year}-0001` })).toBeVisible()

  const href = await page.getByRole('link', { name: 'Download PDF' }).getAttribute('href')
  const res = await page.request.get(href as string)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('application/pdf')

  await page.getByRole('link', { name: 'Invoices' }).first().click()
  await expect(page.getByRole('link', { name: `ACME-${year}-0001` })).toBeVisible()
  await expect(page.getByRole('cell', { name: '$2,084.96' })).toBeVisible()
})

test('issued invoice is locked', async ({ page }) => {
  const f = await seed('Invoice Lock Firm')
  await buildDraft(page, f)
  await issue(page)
  await expect(page.getByRole('button', { name: 'Add line' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save details' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Delete draft' })).toHaveCount(0)
})

test('void returns hours', async ({ page }) => {
  const f = await seed('Invoice Void Firm')
  await buildDraft(page, f)
  await issue(page)
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Void invoice' }).click()
  await expect(page.getByTestId('status')).toHaveText('Void')

  await page.goto(`/f/${f.firmId}/invoices/new`)
  await findHours(page)
  await expect(page.getByRole('cell', { name: '15.50' })).toBeVisible()
})

test('preview a draft', async ({ page }) => {
  const f = await seed('Invoice Preview Firm')
  await buildDraft(page, f)
  const href = await page.getByRole('link', { name: 'Preview PDF' }).getAttribute('href')
  const res = await page.request.get(href as string)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('application/pdf')
})

test('consultant gets 404 on /invoices', async ({ page }) => {
  const f = await newFirm('Invoice Gate Firm')
  await login(page, f.consultant.email)
  expect((await page.goto(`/f/${f.firmId}/invoices`))?.status()).toBe(404)
})
