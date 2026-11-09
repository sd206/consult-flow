import { test, expect, type Page } from '@playwright/test'
import { adminDb, newFirm, TEST_PASSWORD } from '../integration/helpers'

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test('consultant role gets 404 on vendors and consultants pages', async ({ page }) => {
  const f = await newFirm('Gate People Firm')
  await login(page, f.consultant.email)
  expect((await page.goto(`/f/${f.firmId}/vendors`))?.status()).toBe(404)
  expect((await page.goto(`/f/${f.firmId}/consultants`))?.status()).toBe(404)
})

test('manager adds a vendor and a vendor consultant with a cost rate', async ({ page }) => {
  const f = await newFirm('People Firm')
  await login(page, f.manager.email)

  await page.goto(`/f/${f.firmId}/vendors`)
  await expect(page.getByRole('heading', { name: 'Vendors' })).toBeVisible()
  const vendorName = `Vendor ${crypto.randomUUID().slice(0, 8)}`
  await page.getByLabel('Vendor name').last().fill(vendorName)
  await page.getByRole('button', { name: 'Add vendor' }).click()
  await expect(page.getByRole('status')).toContainText('Vendor added')
  await expect(page.getByRole('rowheader', { name: vendorName })).toBeVisible()

  await page.goto(`/f/${f.firmId}/consultants`)
  await expect(page.getByLabel('Vendor', { exact: true })).toHaveCount(0)
  const name = `Cons ${crypto.randomUUID().slice(0, 8)}`
  const email = `cons-${crypto.randomUUID()}@test.local`
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Type').selectOption('vendor')
  await page.getByLabel('Vendor', { exact: true }).selectOption({ label: vendorName })
  await page.getByLabel('Initial hourly cost (optional)').fill('95')
  await page.getByLabel('Cost effective from').fill('2026-01-01')
  await page.getByRole('button', { name: 'Add consultant' }).click()
  await expect(page.getByRole('status')).toContainText('Consultant added')
  await expect(page.getByRole('cell', { name: '$95.00' })).toBeVisible()

  const { data } = await adminDb().from('consultants').select('vendor_id').eq('email', email)
  expect(data).toHaveLength(1)
  expect(data?.[0]?.vendor_id).not.toBeNull()

  await page.getByRole('link', { name }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.getByLabel('Hourly cost').fill('105.5')
  await page.getByLabel('Effective from').fill('2026-06-01')
  await page.getByRole('button', { name: 'Add cost rate' }).click()
  await expect(page.getByRole('status').last()).toContainText('Cost rate added')
  await expect(page.getByRole('cell', { name: '$105.50' })).toBeVisible()
  // Managers cannot invite (admin only).
  await expect(page.getByRole('button', { name: 'Invite to log in' })).toHaveCount(0)
})

test('admin "Invite to log in" links a consultant record to an existing member', async ({ page }) => {
  const f = await newFirm('Link People Firm')
  // Inserted directly so it starts unlinked; its email belongs to the firm's manager.
  const { data: row } = await adminDb()
    .from('consultants')
    .insert({ firm_id: f.firmId, name: 'Manager Billing', email: f.manager.email, type: 'employee' })
    .select('id')
    .single()
  await login(page, f.admin.email)
  await page.goto(`/f/${f.firmId}/consultants/${row!.id}`)
  await page.getByRole('button', { name: 'Invite to log in' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Linked to existing user.' })).toBeVisible()
  await expect(page.getByText('That person is already a member of this firm.')).toHaveCount(0)
  const { data } = await adminDb().from('consultants').select('user_id').eq('id', row!.id).single()
  expect(data?.user_id).toBe(f.manager.id)
})
