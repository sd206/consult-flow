import { test, expect, type Page } from '@playwright/test'
import { adminDb, newFirm, TEST_PASSWORD } from '../integration/helpers'

async function login(page: Page, email: string, password = TEST_PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test('platform owner creates a firm; non-owners get 404', async ({ page }) => {
  const f = await newFirm('Gate Firm')
  await login(page, f.admin.email)
  expect((await page.goto('/platform/firms'))?.status()).toBe(404)
  await page.context().clearCookies()

  await login(page, 'owner@local.test', 'owner-password-123')
  await page.goto('/platform/firms')
  const name = `E2E Firm ${crypto.randomUUID().slice(0, 8)}`
  const email = `e2e-admin-${crypto.randomUUID()}@test.local`
  await page.getByLabel('Firm name').fill(name)
  await page.getByLabel('First Admin email').fill(email)
  await page.getByRole('button', { name: 'Create firm' }).click()
  await expect(page.getByRole('status')).toContainText('Firm created')
  await expect(page.getByRole('cell', { name })).toBeVisible()
  const { data } = await adminDb().from('firms').select('id').eq('name', name)
  expect(data).toHaveLength(1)
})

test('admin manages members; manager gets 404', async ({ page }) => {
  const f = await newFirm('Members Firm')
  await login(page, f.manager.email)
  expect((await page.goto(`/f/${f.firmId}/users`))?.status()).toBe(404)
  await page.context().clearCookies()

  await login(page, f.admin.email)
  await page.goto(`/f/${f.firmId}/users`)
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
  // No remove button for the admin's own row.
  await expect(page.getByRole('button', { name: /^Remove/ })).toHaveCount(2)
  await expect(page.getByRole('button', { name: `Remove ${f.admin.email}` })).toHaveCount(0)

  const email = `invitee-${crypto.randomUUID()}@test.local`
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Role', { exact: true }).selectOption('manager')
  await page.getByRole('button', { name: 'Invite' }).click()
  await expect(page.getByRole('status')).toContainText('Invitation sent')
  await expect(page.getByRole('cell', { name: email, exact: true })).toBeVisible()
})
