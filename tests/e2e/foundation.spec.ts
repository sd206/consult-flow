import { test, expect, type Page } from '@playwright/test'
import { adminDb, newFirm, TEST_PASSWORD } from '../integration/helpers'

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
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
  test('admin sees counts and the finish-setup checklist; manager sees no settings link', async ({ page }) => {
    const f = await newFirm('Dash Firm')
    await login(page, f.admin.email)
    await page.goto(`/f/${f.firmId}`)
    await expect(page.getByText('Active consultants')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Finish setup' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Add your firm logo' })).toHaveAttribute('href', `/f/${f.firmId}/settings`)
    await expect(page.getByRole('link', { name: 'Add a client' })).toHaveAttribute('href', `/f/${f.firmId}/clients`)
    await expect(page.getByText('Not done').first()).toBeVisible()
  })
})
