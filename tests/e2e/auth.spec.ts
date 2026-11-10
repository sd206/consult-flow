import { test, expect, type Page } from '@playwright/test'
import { firmNav, openMenu } from './nav'
import { adminDb, newFirm, TEST_PASSWORD } from '../integration/helpers'

type Fixture = Awaited<ReturnType<typeof newFirm>>

const twoFirms = test.extend<{ a: Fixture; b: Fixture }>({
  a: async ({}, run) => run(await newFirm('Firm A')),
  b: async ({}, run) => run(await newFirm('Firm B')),
})

async function login(page: Page, email: string, password = TEST_PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('unauthenticated visit to / lands on /login', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})

twoFirms('consultant logs in and sees only consultant nav', async ({ page, a }) => {
  await login(page, a.consultant.email)
  await expect(page).toHaveURL(new RegExp(`/f/${a.firmId}$`))
  const nav = firmNav(page)
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(nav.getByRole('button', { name: 'Billing' })).toHaveCount(0)
  await expect(nav.getByRole('button', { name: 'Setup' })).toHaveCount(0)
  await openMenu(page, 'Work')
  await expect(nav.getByRole('link', { name: 'My projects' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Timesheet approvals' })).toHaveCount(0)
})

twoFirms('manager sees Clients but not Users', async ({ page, a }) => {
  await login(page, a.manager.email)
  const nav = firmNav(page)
  await openMenu(page, 'Setup')
  await expect(nav.getByRole('link', { name: 'Clients' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0)
})

twoFirms('other firm and manager-only pages are 404 for consultant', async ({ page, a, b }) => {
  await login(page, a.consultant.email)
  await expect(page).toHaveURL(new RegExp(`/f/${a.firmId}$`))
  const other = await page.goto(`/f/${b.firmId}`)
  expect(other?.status()).toBe(404)
  const clients = await page.goto(`/f/${a.firmId}/clients`)
  expect(clients?.status()).toBe(404)
  const projects = await page.goto(`/f/${a.firmId}/projects`)
  expect(projects?.status()).toBe(404)
})

test('wrong password shows an alert', async ({ page }) => {
  await login(page, 'nobody@test.local')
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible()
})

test('unauthenticated request to a path ending in an asset-like suffix still hits middleware', async ({ page }) => {
  await page.goto('/f/00000000-0000-0000-0000-000000000000/xpng')
  await expect(page).toHaveURL(/\/login$/)
})

test('magic link for an unknown email shows neutral message and creates no user', async ({ page }) => {
  const email = `ghost-${crypto.randomUUID()}@test.local`
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a link' }).click()
  await expect(page.getByRole('status')).toContainText('If that email has an account')
  // Every auth user gets a profile row (handle_new_user trigger), so look the email up directly.
  const { data, error } = await adminDb().from('profiles').select('user_id').eq('email', email.toLowerCase())
  expect(error).toBeNull()
  expect(data).toEqual([])
})

test('platform owner sees the Platform link on /', async ({ page }) => {
  await login(page, 'owner@local.test', 'owner-password-123')
  await expect(page.getByRole('link', { name: 'Platform' })).toBeVisible()
  await expect(page).toHaveURL(/localhost:3000\/$/)
})
