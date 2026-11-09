import { test, expect, type Page } from '@playwright/test'
import { adminDb, newFirm, TEST_PASSWORD } from '../integration/helpers'

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test('manager gets 404 on settings', async ({ page }) => {
  const f = await newFirm('Settings Gate')
  await login(page, f.manager.email)
  expect((await page.goto(`/f/${f.firmId}/settings`))?.status()).toBe(404)
})

test('admin edits settings, sees inline pattern error, uploads a logo', async ({ page }) => {
  const f = await newFirm('Settings Firm')
  await login(page, f.admin.email)
  await page.goto(`/f/${f.firmId}/settings`)
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  await page.getByLabel('Invoice number pattern').fill('INV-{YYYY}')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'exactly one {SEQ:n}' })).toBeVisible()

  await page.getByLabel('Invoice number pattern').fill('SRS-{YYYY}-{SEQ:4}')
  await page.getByLabel('Default tax percent').fill('20')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Settings saved' })).toBeVisible()
  const { data } = await adminDb().from('firms').select('invoice_number_pattern').eq('id', f.firmId).single()
  expect(data?.invoice_number_pattern).toBe('SRS-{YYYY}-{SEQ:4}')

  await page.getByLabel(/Logo file/).setInputFiles('tests/e2e/fixtures/logo.png')
  await page.getByRole('button', { name: 'Upload logo' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Logo updated' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Firm logo' })).toBeVisible()
})
