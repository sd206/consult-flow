import { test, expect, type Page } from '@playwright/test'
import { answerConfirm } from './confirm'
import { newFirm, TEST_PASSWORD } from '../integration/helpers'

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const row = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name })

test('admin manages invoice templates', async ({ page }) => {
  const f = await newFirm('Template Firm')
  await login(page, f.admin.email)
  await page.goto(`/f/${f.firmId}/settings`)
  await page.getByRole('link', { name: 'Invoice templates' }).click()
  await expect(page).toHaveURL(/\/settings\/templates/)
  await expect(row(page, 'Standard')).toContainText('Default')

  await page.getByRole('link', { name: 'New template' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Modern blue')
  await page.getByLabel('Layout').selectOption('modern')
  await page.getByLabel('Accent colour').fill('#1D4ED8')
  await page.getByLabel('Add hours detail page').check()
  await page.getByRole('button', { name: 'Save template' }).click()
  await expect(row(page, 'Modern blue')).toBeVisible()
  await expect(row(page, 'Modern blue')).toContainText('Modern')
  await expect(row(page, 'Modern blue')).not.toContainText('Default')

  // Edit round-trips the saved values.
  await row(page, 'Modern blue').getByRole('link', { name: 'Edit' }).click()
  await expect(page.getByLabel('Accent colour')).toHaveValue('#1D4ED8')
  await expect(page.getByLabel('Add hours detail page')).toBeChecked()
  await expect(page.getByLabel('Layout')).toHaveValue('modern')

  await page.goto(`/f/${f.firmId}/settings/templates`)
  await row(page, 'Modern blue').getByRole('button', { name: 'Make default' }).click()
  await expect(row(page, 'Modern blue')).toContainText('Default')
  await expect(row(page, 'Modern blue').getByRole('button', { name: 'Delete' })).toHaveCount(0)
  await expect(row(page, 'Standard')).not.toContainText('Default')

  await row(page, 'Standard').getByRole('button', { name: 'Make default' }).click()
  await expect(row(page, 'Standard')).toContainText('Default')
  await row(page, 'Modern blue').getByRole('button', { name: 'Delete' }).click()
  await answerConfirm(page)
  await expect(page.getByText('Modern blue')).toHaveCount(0)
})

test('bad accent colour shows a field error', async ({ page }) => {
  const f = await newFirm('Template Colour Firm')
  await login(page, f.admin.email)
  await page.goto(`/f/${f.firmId}/settings/templates?new=1`)
  await page.getByLabel('Name', { exact: true }).fill('Bad colour')
  await page.getByLabel('Accent colour').fill('blue')
  await page.getByRole('button', { name: 'Save template' }).click()
  await expect(page.getByText('Use a colour like #1F2937.')).toBeVisible()
})

test('manager gets 404 on template settings', async ({ page }) => {
  const f = await newFirm('Template Gate')
  await login(page, f.manager.email)
  expect((await page.goto(`/f/${f.firmId}/settings/templates`))?.status()).toBe(404)
})
