import { test, expect, type Page } from '@playwright/test'
import { adminDb, newFirm, TEST_PASSWORD } from '../integration/helpers'
import { issueManualInvoice } from '../integration/invoice-fixtures'

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function buttonStyle(page: Page, selector: string, hover = false) {
  const input = page.locator(selector).first()
  await expect(input).toBeVisible()
  if (hover) await input.hover({ position: { x: 10, y: 10 } })
  return input.evaluate((el) => {
    const s = getComputedStyle(el, '::file-selector-button')
    return { bg: s.backgroundColor, color: s.color, weight: s.fontWeight, radius: s.borderRadius, cursor: s.cursor }
  })
}

const PRIMARY = 'rgb(15, 118, 110)'
const PRIMARY_HOVER = 'rgb(17, 94, 89)'

test('the file picker button is teal on every page that has one', async ({ page }) => {
  const f = await newFirm('File Buttons Firm')
  const inv = await issueManualInvoice(f, '100.00')
  const { data: cat, error: cErr } = await adminDb()
    .from('expense_categories')
    .insert({ firm_id: f.firmId, name: 'Misc' })
    .select('id')
    .single()
  expect(cErr).toBeNull()
  const { data: exp, error: eErr } = await adminDb()
    .from('expenses')
    .insert({ firm_id: f.firmId, category_id: cat!.id, payee: 'Shop', amount: '5.00', spent_on: '2026-11-02' })
    .select('id')
    .single()
  expect(eErr).toBeNull()

  const { data: acct, error: aErr } = await adminDb()
    .from('bank_accounts')
    .insert({ firm_id: f.firmId, name: 'Main checking', kind: 'bank' })
    .select('id')
    .single()
  expect(aErr).toBeNull()

  await login(page, f.admin.email)
  const pages: [string, string][] = [
    [`/f/${f.firmId}/expenses/new`, '#exp-files'],
    [`/f/${f.firmId}/expenses/${exp!.id}`, '#add-files'],
    [`/f/${f.firmId}/payments/record?invoice=${inv.invoiceId}`, '#rec-files'],
    [`/f/${f.firmId}/bank/${acct!.id}`, '#stmt-file'],
    [`/f/${f.firmId}/settings`, '#logo-file'],
  ]
  for (const [url, sel] of pages) {
    await page.goto(url)
    const normal = await buttonStyle(page, sel)
    expect(normal, url).toMatchObject({ bg: PRIMARY, color: 'rgb(255, 255, 255)', weight: '500', cursor: 'pointer' })
    expect((await buttonStyle(page, sel, true)).bg, url).toBe(PRIMARY_HOVER)
  }
})
