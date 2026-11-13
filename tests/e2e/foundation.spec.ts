import { test, expect, type Page } from '@playwright/test'
import { adminDb, newFirm, TEST_PASSWORD } from '../integration/helpers'

async function login(page: Page, email: string, password = TEST_PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('consultant', () => {
  test('sees own assignment with client name, and no rate in the page source', async ({ page }) => {
    const f = await newFirm('Consultant View Firm')
    const db = adminDb()
    const { data: client } = await db.from('clients').insert({ firm_id: f.firmId, name: 'Globex Corp' }).select('id').single()
    const { data: project } = await db
      .from('projects')
      .insert({ firm_id: f.firmId, client_id: client!.id, name: 'Rollout Alpha', code: 'RA-1' })
      .select('id')
      .single()
    const { data: cons } = await db
      .from('consultants')
      .insert({
        firm_id: f.firmId,
        name: 'Con Sultant',
        email: `c-${crypto.randomUUID()}@test.local`,
        type: 'employee',
        user_id: f.consultant.id,
      })
      .select('id')
      .single()
    await db.from('project_assignments').insert({
      firm_id: f.firmId,
      project_id: project!.id,
      consultant_id: cons!.id,
      client_rate: 180.37,
      effective_from: '2026-01-01',
    })

    await login(page, f.consultant.email)
    await page.goto(`/f/${f.firmId}/my-projects`)
    await expect(page.getByRole('heading', { name: 'My projects' })).toBeVisible()
    await expect(page.getByRole('rowheader', { name: 'Rollout Alpha' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Globex Corp' })).toBeVisible()
    expect(await page.content()).not.toContain('180.37')

    // Dashboard shows a link to My projects and no admin counts.
    await page.goto(`/f/${f.firmId}`)
    await expect(page.getByRole('link', { name: 'My projects' }).last()).toBeVisible()
    await expect(page.getByText('Active consultants')).toHaveCount(0)
    await expect(page.getByText('Finish setup')).toHaveCount(0)
  })

  test('with no assignments sees the empty state', async ({ page }) => {
    const f = await newFirm('Empty Consultant Firm')
    await login(page, f.consultant.email)
    await page.goto(`/f/${f.firmId}/my-projects`)
    await expect(page.getByText("You aren't assigned to any projects yet.")).toBeVisible()
  })
})

test.describe('dashboard', () => {
  test('admin sees counts and the finish-setup checklist', async ({ page }) => {
    const f = await newFirm('Dash Firm')
    await login(page, f.admin.email)
    await page.goto(`/f/${f.firmId}`)
    await expect(page.getByText('Active consultants')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Finish setup' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Add your firm logo' })).toHaveAttribute('href', `/f/${f.firmId}/settings`)
    await expect(page.getByRole('link', { name: 'Add a client' })).toHaveAttribute('href', `/f/${f.firmId}/clients`)
    await expect(page.getByText('Not done').first()).toBeVisible()
  })

  test('manager sees the finish-setup checklist with a settings link', async ({ page }) => {
    const f = await newFirm('Dash Manager Firm')
    await login(page, f.manager.email)
    await page.goto(`/f/${f.firmId}`)
    await expect(page.getByRole('heading', { name: 'Finish setup' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Add your firm logo' })).toHaveAttribute('href', `/f/${f.firmId}/settings`)
  })
})

test.describe('foundation flow', () => {
  test('platform owner to first assignment', async ({ page }) => {
    test.setTimeout(90_000)
    const run = Date.now().toString(36)
    const db = adminDb()
    const firmName = `Acme Consulting ${run}`
    const adminEmail = `admin+${run}@acme.test`
    const managerEmail = `manager+${run}@acme.test`
    const vendorName = `Northwind ${run}`
    const clientName = `Globex ${run}`
    const code = `GLX-${run}`
    const today = new Date().toISOString().slice(0, 10)

    // Pre-create accounts with passwords so the invite attaches existing users and sends no email.
    for (const email of [adminEmail, managerEmail]) {
      const { error } = await db.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { password_set: true },
      })
      if (error) throw new Error(`createUser failed: ${error.message}`)
    }

    // Platform owner creates the firm.
    await login(page, 'owner@local.test', 'owner-password-123')
    await page.goto('/platform/firms')
    await page.getByLabel('Firm name').fill(firmName)
    await page.getByLabel('First Admin email').fill(adminEmail)
    await page.getByRole('button', { name: 'Create firm' }).click()
    await expect(page.getByRole('status')).toContainText('Firm created')
    await expect(page.getByRole('cell', { name: firmName })).toBeVisible()
    const { data: firm } = await db.from('firms').select('id').eq('name', firmName).single()
    const firmId = firm!.id as string
    await page.context().clearCookies()

    // Admin configures settings and invites a manager.
    await login(page, adminEmail)
    await page.goto(`/f/${firmId}/settings`)
    await page.getByLabel('Invoice number pattern').fill('ACME-{YYYY}-{SEQ:4}')
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved' })).toBeVisible()
    await page.getByLabel(/Logo file/).setInputFiles('tests/e2e/fixtures/logo.png')
    await page.getByRole('button', { name: 'Upload logo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Logo updated' })).toBeVisible()

    // Admin sets up the vendor and consultant (admin-only).
    await page.goto(`/f/${firmId}/vendors`)
    await page.getByLabel('Vendor name').last().fill(vendorName)
    await page.getByRole('button', { name: 'Add vendor' }).click()
    await expect(page.getByRole('status')).toContainText('Vendor added')
    await expect(page.getByRole('rowheader', { name: vendorName })).toBeVisible()

    await page.goto(`/f/${firmId}/consultants`)
    await page.getByLabel('Name', { exact: true }).fill('Dana')
    await page.getByLabel('Email', { exact: true }).fill(`dana+${run}@test.local`)
    await page.getByLabel('Type').selectOption('vendor')
    await page.getByLabel('Vendor', { exact: true }).selectOption({ label: vendorName })
    await page.getByLabel('Initial hourly cost (optional)').fill('90')
    await page.getByLabel('Cost effective from').fill('2026-01-01')
    await page.getByRole('button', { name: 'Add consultant' }).click()
    await expect(page.getByRole('status')).toContainText('Consultant added')
    await expect(page.getByRole('cell', { name: '$90.00' })).toBeVisible()

    await page.goto(`/f/${firmId}/users`)
    await page.getByLabel('Email', { exact: true }).fill(managerEmail)
    await page.getByLabel('Role', { exact: true }).selectOption('manager')
    await page.getByRole('button', { name: 'Invite' }).click()
    await expect(page.getByRole('status')).toContainText('Existing user added to this firm. We emailed them a sign-in link.')
    await expect(page.getByRole('cell', { name: managerEmail, exact: true })).toBeVisible()
    await page.context().clearCookies()

    // Manager sets up client, project and assignment.
    await login(page, managerEmail)
    await page.goto(`/f/${firmId}/clients`)
    await page.getByLabel('Client name').last().fill(clientName)
    await page.getByRole('button', { name: 'Add client' }).click()
    await expect(page.getByRole('status')).toContainText('Client added')

    await page.goto(`/f/${firmId}/projects`)
    await page.getByLabel('Client', { exact: true }).selectOption({ label: clientName })
    await page.getByLabel('Project name').fill('Portal')
    await page.getByLabel('Project code (optional)').fill(code)
    await page.getByRole('button', { name: 'Add project' }).click()
    await expect(page.getByRole('status')).toContainText('Project added')
    await page.getByRole('link', { name: 'Portal' }).click()
    await expect(page.getByRole('heading', { name: 'Portal' })).toBeVisible()

    await page.getByLabel('Consultant', { exact: true }).selectOption({ label: 'Dana' })
    await page.getByLabel('Client rate (per hour)').fill('150')
    await page.getByLabel('Start date').last().fill(today)
    await page.getByRole('button', { name: 'Assign consultant' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Consultant assigned' })).toBeVisible()
    const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Dana' }) })
    await expect(row).toContainText('60.00')
  })
})
