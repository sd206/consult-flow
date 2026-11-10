import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { adminDb, newFirm, TEST_PASSWORD } from '../integration/helpers'

const REMITTANCE = path.join(__dirname, 'fixtures', 'remittance.pdf')
const FAKE = path.join(__dirname, 'fixtures', 'fake.pdf')

type Firm = Awaited<ReturnType<typeof newFirm>>

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function setup(name: string) {
  const f = await newFirm(name)
  const db = adminDb()
  const ins = async (n: string) => {
    const { data, error } = await db.from('clients').insert({ firm_id: f.firmId, name: n }).select('id').single()
    if (error || !data) throw new Error(error?.message)
    return data.id as string
  }
  const globex = await ins('Globex')
  const initech = await ins('Initech')
  const { error } = await db.from('projects').insert({ firm_id: f.firmId, client_id: globex, name: 'Portal' })
  if (error) throw new Error(error.message)
  return { f, globex, initech }
}

async function openNew(page: Page, f: Firm) {
  await login(page, f.manager.email)
  await page.goto(`/f/${f.firmId}`)
  await page.getByRole('link', { name: 'Expenses', exact: true }).click()
  await page.getByRole('link', { name: 'New expense' }).click()
  await expect(page.getByRole('heading', { name: 'New expense' })).toBeVisible()
}

async function fillExpense(
  page: Page,
  o: { payee: string; amount: string; category?: string; client?: string; project?: string; file?: string },
) {
  await page.getByLabel('Category').selectOption({ label: o.category ?? 'Travel' })
  await page.getByLabel('Payee').fill(o.payee)
  await page.getByLabel('Amount').fill(o.amount)
  if (o.client) await page.getByLabel('Client').selectOption({ label: o.client })
  if (o.project) await page.getByLabel('Project').selectOption({ label: o.project })
  if (o.file) await page.getByLabel('Receipts').setInputFiles(o.file)
  await page.getByRole('button', { name: 'Save expense' }).click()
  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]{36}/)
}

test('manager records an expense with a receipt', async ({ page }) => {
  const { f } = await setup('Exp Receipt Firm')
  await openNew(page, f)
  await fillExpense(page, { payee: 'Skyline Air', amount: '412.37', client: 'Globex', file: REMITTANCE })
  const link = page.getByRole('link', { name: 'remittance.pdf' })
  await expect(link).toBeVisible()
  const res = await page.request.get((await link.getAttribute('href'))!)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('application/pdf')

  await page.goto(`/f/${f.firmId}/expenses`)
  const row = page.getByRole('row', { name: /Skyline Air/ })
  await expect(row).toContainText('$412.37')
  await expect(row.getByRole('cell').last()).toHaveText('1')
})

test('the project sets the client', async ({ page }) => {
  const { f, globex } = await setup('Exp Project Firm')
  await openNew(page, f)
  await expect(page.getByText('The client is set from the project.')).toBeVisible()
  await fillExpense(page, { payee: 'Portal Cafe', amount: '23.45', client: 'Initech', project: 'Portal' })
  await expect(page.getByLabel('Client')).toHaveValue(globex)
})

test('no receipt filter', async ({ page }) => {
  const { f } = await setup('Exp NoReceipt Firm')
  await openNew(page, f)
  await fillExpense(page, { payee: 'Has Receipt Co', amount: '51.11', file: REMITTANCE })
  await page.goto(`/f/${f.firmId}/expenses/new`)
  await fillExpense(page, { payee: 'Bare Co', amount: '77.77' })

  await page.goto(`/f/${f.firmId}/expenses`)
  await expect(page.getByText('2 expenses · $128.88')).toBeVisible()
  await expect(page.getByRole('row', { name: /Bare Co/ })).toContainText('No receipt')
  await expect(page.getByRole('row', { name: /Has Receipt Co/ })).toBeVisible()
  await page.getByLabel('No receipt only').check()
  await page.getByRole('button', { name: 'Filter' }).click()
  await expect(page.getByRole('row', { name: /Has Receipt Co/ })).toHaveCount(0)
  await expect(page.getByRole('row', { name: /Bare Co/ })).toBeVisible()
  await expect(page.getByText('1 expense · $77.77')).toBeVisible()
})

test('categories: add, duplicate, retire, restore, delete rules', async ({ page }) => {
  const { f } = await setup('Exp Categories Firm')
  await login(page, f.manager.email)
  await page.goto(`/f/${f.firmId}/expenses/categories`)
  const add = page.getByRole('form', { name: 'Add category' })
  await add.getByLabel('Name').fill('Meals')
  await add.getByRole('button', { name: 'Add category' }).click()
  await expect(page.getByRole('row', { name: /Meals/ })).toBeVisible()
  await add.getByLabel('Name').fill(' meals ')
  await add.getByRole('button', { name: 'Add category' }).click()
  await expect(page.getByRole('alert').filter({ hasText: /already/i })).toBeVisible()

  await page.getByRole('row', { name: /Meals/ }).getByRole('button', { name: 'Retire' }).click()
  await expect(page.getByRole('row', { name: /Meals/ })).toContainText('Retired')
  await page.goto(`/f/${f.firmId}/expenses/new`)
  await expect(page.getByLabel('Category').locator('option', { hasText: 'Meals' })).toHaveCount(0)

  await page.goto(`/f/${f.firmId}/expenses/categories`)
  await page.getByRole('row', { name: /Meals/ }).getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByRole('row', { name: /Meals/ })).toContainText('Active')

  await page.goto(`/f/${f.firmId}/expenses/new`)
  await fillExpense(page, { payee: 'Airline', amount: '99.01', category: 'Travel' })
  await page.goto(`/f/${f.firmId}/expenses/categories`)
  await expect(page.getByRole('row', { name: /Travel/ }).getByRole('button', { name: 'Delete' })).toHaveCount(0)
  await expect(page.getByRole('row', { name: /Meals/ }).getByRole('button', { name: 'Delete' })).toBeVisible()
})

test('delete an expense', async ({ page }) => {
  const { f } = await setup('Exp Delete Firm')
  await openNew(page, f)
  await fillExpense(page, { payee: 'Gone Co', amount: '65.43' })
  let message = ''
  page.once('dialog', (d) => {
    message = d.message()
    void d.accept()
  })
  await page.getByRole('button', { name: 'Delete expense' }).click()
  await expect(page).toHaveURL(/\/expenses(\?|$)/)
  expect(message).toBe('Delete this expense of $65.43? Its receipts are deleted too.')
  await expect(page.getByRole('row', { name: /Gone Co/ })).toHaveCount(0)
  await expect(page.getByText('No expenses match these filters.')).toBeVisible()
})

test('a consultant gets a 404', async ({ page }) => {
  const { f } = await setup('Exp Consultant Firm')
  await login(page, f.consultant.email)
  for (const p of ['expenses', 'expenses/categories']) {
    const res = await page.goto(`/f/${f.firmId}/${p}`)
    expect(res?.status()).toBe(404)
  }
})

test('a rejected receipt is named in the fixed notice', async ({ page }) => {
  const { f } = await setup('Exp Rejected Firm')
  await openNew(page, f)
  await fillExpense(page, { payee: 'Fake Receipt Co', amount: '88.21', file: FAKE })
  expect(new URL(page.url()).searchParams.get('filesRejected')).toBe('fake.pdf')
  await expect(page.getByRole('status').filter({ hasText: "Expense saved, but some receipts weren't attached: fake.pdf." })).toBeVisible()
  await expect(page.getByRole('link', { name: 'fake.pdf' })).toHaveCount(0)

  // Only names come from the URL; the sentence is fixed and long values are capped.
  const url = new URL(page.url())
  url.searchParams.set('filesRejected', 'y'.repeat(400))
  await page.goto(url.toString())
  await expect(page.getByRole('status').filter({ hasText: `attached: ${'y'.repeat(300)}.` })).toBeVisible()
})

test('editing: a project of another client shows that client after saving', async ({ page }) => {
  const { f, globex } = await setup('Exp Edit Client Firm')
  await openNew(page, f)
  await fillExpense(page, { payee: 'Switch Co', amount: '19.73', client: 'Initech' })
  await expect(page.getByLabel('Client')).toBeEnabled()
  await page.getByLabel('Project').selectOption({ label: 'Portal' })
  await expect(page.getByLabel('Client')).toBeDisabled()
  await expect(page.getByLabel('Client')).toHaveValue(globex)
  await page.getByRole('button', { name: 'Save expense' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Expense saved.' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Client')).toHaveValue(globex)
  await expect(page.getByLabel('Project')).not.toHaveValue('')

  // Clearing the project shows the stored client, now the project's.
  await page.getByLabel('Project').selectOption({ label: 'No project' })
  await expect(page.getByLabel('Client')).toBeEnabled()
  await expect(page.getByLabel('Client')).toHaveValue(globex)
})

test('a page past the last goes to the last page', async ({ page }) => {
  const { f } = await setup('Exp Paging Firm')
  await openNew(page, f)
  await fillExpense(page, { payee: 'Only Co', amount: '12.34' })
  await page.goto(`/f/${f.firmId}/expenses?page=7`)
  await expect(page).toHaveURL(/[?&]page=1(&|$)/)
  await expect(page.getByRole('row', { name: /Only Co/ })).toBeVisible()
  await expect(page.getByText('1 expense · $12.34')).toBeVisible()
})
