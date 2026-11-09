import { test, expect, type Page } from '@playwright/test'
import { newFirm, TEST_PASSWORD } from '../integration/helpers'

type Fixture = Awaited<ReturnType<typeof newFirm>>

const twoFirms = test.extend<{ a: Fixture; b: Fixture }>({
  a: async ({}, run) => run(await newFirm('Firm A')),
  b: async ({}, run) => run(await newFirm('Firm B')),
})

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('unauthenticated visit to / lands on /login', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})

twoFirms('consultant logs in and sees only consultant nav', async ({ page, a }) => {
  await login(page, a.consultant.email)
  await expect(page).toHaveURL(new RegExp(`/f/${a.firmId}$`))
  const nav = page.getByRole('navigation')
  await expect(nav.getByRole('link', { name: 'My projects' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Clients' })).toHaveCount(0)
})

twoFirms('manager sees Clients but not Users', async ({ page, a }) => {
  await login(page, a.manager.email)
  const nav = page.getByRole('navigation')
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
})

test('wrong password shows an alert', async ({ page }) => {
  await login(page, 'nobody@test.local')
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible()
})
