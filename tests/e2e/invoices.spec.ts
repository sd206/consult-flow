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

const ISSUE_TAIL = "It gets the next number and can't be edited afterwards."

async function issue(page: Page) {
  let message = ''
  page.once('dialog', (d) => {
    message = d.message()
    void d.accept()
  })
  await page.getByRole('button', { name: 'Issue invoice' }).click()
  await expect(page.getByTestId('status')).toHaveText('Issued')
  // Drafts are dated today, so no past-date warning.
  expect(message).toMatch(/^Issue this invoice dated \d{1,2} [A-Z][a-z]{2} \d{4} and due \d{1,2} [A-Z][a-z]{2} \d{4}\? /)
  expect(message.endsWith(ISSUE_TAIL)).toBe(true)
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
  await expect(page.getByText('This invoice is void.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download original PDF' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download PDF', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Regenerate PDF' })).toHaveCount(0)

  await page.goto(`/f/${f.firmId}/invoices/new`)
  await findHours(page)
  await expect(page.getByRole('cell', { name: '15.50' })).toBeVisible()
})

test('the draft remembers which consultants are included', async ({ page }) => {
  const f = await seed('Invoice Selection Firm')
  await buildDraft(page, f)
  const box = page.getByRole('checkbox', { name: 'Con Sultant' })
  const hoursLine = page.getByLabel('Line description Con Sultant Rollout')
  await expect(box).toBeChecked()
  await expect(hoursLine).toBeVisible()

  await box.uncheck()
  await page.getByRole('button', { name: 'Regenerate lines' }).click()
  await expect(hoursLine).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Con Sultant' })).not.toBeChecked()
  await expect(hoursLine).toHaveCount(0)
  await expect(page.getByTestId('subtotal')).toHaveText('$0.00')

  await page.getByRole('checkbox', { name: 'Con Sultant' }).check()
  await page.getByRole('button', { name: 'Regenerate lines' }).click()
  await expect(hoursLine).toHaveValue('Discovery; Workshop')
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Con Sultant' })).toBeChecked()
  await expect(page.getByTestId('subtotal')).toHaveText('$2,066.62')
})

test('issuing warns about an issue date in the past', async ({ page }) => {
  const f = await seed('Invoice Past Date Firm')
  await buildDraft(page, f)
  await page.getByLabel('Issue date').fill('2026-01-05')
  await page.getByLabel('Due date').fill('2026-02-04')
  await page.getByRole('button', { name: 'Save details' }).click()
  // Wait for the save to land before reloading (the field already shows the typed value).
  await expect
    .poll(async () => {
      const { data } = await adminDb().from('invoices').select('issue_date').eq('firm_id', f.firmId).single()
      return (data as { issue_date: string } | null)?.issue_date
    })
    .toBe('2026-01-05')
  await page.reload()
  await expect(page.getByLabel('Issue date')).toHaveValue('2026-01-05')

  let message = ''
  page.once('dialog', (d) => {
    message = d.message()
    void d.dismiss()
  })
  await page.getByRole('button', { name: 'Issue invoice' }).click()
  await expect.poll(() => message).toBe(`The issue date is in the past. Issue this invoice dated 5 Jan 2026 and due 4 Feb 2026? ${ISSUE_TAIL}`)
  await expect(page.getByRole('heading', { name: 'Draft invoice' })).toBeVisible()
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
