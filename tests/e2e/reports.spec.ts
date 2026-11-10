import { test, expect, type Page } from '@playwright/test'
import { newFirm, TEST_PASSWORD } from '../integration/helpers'
import { seedPnlScenario } from '../integration/pnl-fixtures'

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function setup(name: string) {
  const f = await newFirm(name)
  const ids = await seedPnlScenario(f)
  return { f, ids }
}

async function openReport(page: Page, f: Awaited<ReturnType<typeof newFirm>>) {
  await login(page, f.manager.email)
  await page.goto(`/f/${f.firmId}`)
  await page.getByRole('navigation', { name: 'Firm' }).getByRole('link', { name: 'Reports', exact: true }).click()
  await expect(page).toHaveURL(/\/reports\/pnl/)
  await page.getByLabel('From').fill('2026-03-01')
  await page.getByLabel('To').fill('2026-05-31')
}

async function show(page: Page, group: string) {
  await page.getByLabel('Group by').selectOption({ label: group })
  await page.getByRole('button', { name: 'Show report' }).click()
  await expect(page).toHaveURL(/from=2026-03-01/)
}

test('by month: net, margin, overhead and total', async ({ page }) => {
  const { f } = await setup('Pnl Month Firm')
  await openReport(page, f)
  await show(page, 'Month')
  const mar = page.getByRole('row', { name: /Mar 2026/ })
  await expect(mar.getByRole('cell').nth(5)).toHaveText('$740.00')
  await expect(mar.getByRole('cell').nth(6)).toHaveText('32.2%')
  const apr = page.getByRole('row', { name: /Apr 2026/ })
  await expect(apr.getByRole('cell').nth(4)).toHaveText('$75.00')
  const total = page.getByRole('row', { name: /^Total/ })
  await expect(total.getByRole('cell').nth(5)).toHaveText('$785.00')
})

test('by client: client rows, unallocated overhead, invoiced and collected', async ({ page }) => {
  const { f } = await setup('Pnl Client Firm')
  await openReport(page, f)
  await show(page, 'Client')
  await expect(page.getByRole('row', { name: /^Globex/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /^Initech/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /^Unallocated overhead/ })).toBeVisible()
  const globex = page.getByRole('row', { name: /^Globex/ })
  await expect(globex.getByRole('cell').nth(7)).toHaveText('$1,620.00')
  await expect(globex.getByRole('cell').nth(8)).toHaveText('$923.79')
  // Overhead is always a column; client rows show a dash, the unallocated and total rows show the amount.
  await expect(globex.getByRole('cell').nth(4)).toHaveText('—')
  const unallocated = page.getByRole('row', { name: /^Unallocated overhead/ })
  await expect(unallocated.getByRole('cell').nth(3)).toHaveText('—')
  await expect(unallocated.getByRole('cell').nth(4)).toHaveText('$75.00')
  await expect(page.getByRole('row', { name: /^Total/ }).getByRole('cell').nth(4)).toHaveText('$75.00')
})

test('filtering to Globex removes the overhead row', async ({ page }) => {
  const { f } = await setup('Pnl Filter Firm')
  await openReport(page, f)
  await page.getByLabel('Group by').selectOption({ label: 'Client' })
  await page.getByRole('checkbox', { name: 'Globex' }).first().check()
  await page.getByRole('button', { name: 'Show report' }).click()
  await expect(page).toHaveURL(/client=/)
  await expect(page.getByRole('row', { name: /^Globex/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /^Initech/ })).toHaveCount(0)
  await expect(page.getByRole('row', { name: /Unallocated overhead/ })).toHaveCount(0)
  await expect(page.getByText('Overhead is excluded while a client or project filter is applied.')).toBeVisible()
  const href = await page.getByRole('link', { name: 'Export CSV' }).getAttribute('href')
  const res = await page.request.get(href!)
  expect(res.headers()['content-disposition']).toContain('-by-client-filtered.csv')
})

test('export CSV link downloads the report', async ({ page }) => {
  const { f } = await setup('Pnl Csv Firm')
  await openReport(page, f)
  await show(page, 'Month')
  const href = await page.getByRole('link', { name: 'Export CSV' }).getAttribute('href')
  expect(href).toContain('/reports/pnl/csv?')
  const res = await page.request.get(href!)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('text/csv')
  const body = await res.text()
  expect(body).toContain(
    'Group,Revenue from hours,Fees,Discounts,Revenue,Labour cost,Gross profit,Direct expenses,Overhead,Net profit,Margin %,Invoiced,Collected',
  )
  expect(body).toContain('Total')
  expect(body).toContain('785.00')
})

test('the CSV rejects a reversed range with 400 and the message', async ({ page }) => {
  const { f } = await setup('Pnl Range Firm')
  await login(page, f.manager.email)
  const res = await page.request.get(`/f/${f.firmId}/reports/pnl/csv?from=2026-05-01&to=2026-04-01`)
  expect(res.status()).toBe(400)
  expect(await res.text()).toBe('Choose an end date on or after the start date, within 3 years.')
})

test('a consultant gets 404 on the page and the CSV', async ({ page }) => {
  const { f } = await setup('Pnl Access Firm')
  await login(page, f.consultant.email)
  const p = await page.goto(`/f/${f.firmId}/reports/pnl`)
  expect(p?.status()).toBe(404)
  const res = await page.request.get(`/f/${f.firmId}/reports/pnl/csv?from=2026-03-01&to=2026-05-31&group=month`)
  expect(res.status()).toBe(404)
})
