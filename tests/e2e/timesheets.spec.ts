import { test, expect, type Page } from '@playwright/test'
import { goTo } from './nav'
import { addDays, currentWeekStart, formatDayLabel } from '../../src/lib/domain/weeks'
import { adminDb, newFirm, TEST_PASSWORD } from '../integration/helpers'
import { PAST_WEEK, seedTimesheetFixture } from '../integration/timesheet-fixtures'

async function login(page: Page, email: string, password = TEST_PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function seed(f: Awaited<ReturnType<typeof newFirm>>, opts: Parameters<typeof seedTimesheetFixture>[1] = {}) {
  const s = await seedTimesheetFixture(f, { assignFrom: '2026-01-05', ...opts })
  await adminDb().from('projects').update({ name: 'Portal' }).eq('id', s.projectId)
  return s
}

const hours = (page: Page, day: string) => page.getByLabel(`Hours Portal ${formatDayLabel(day)}`, { exact: true })
const note = (page: Page, day: string) => page.getByLabel(`Note Portal ${formatDayLabel(day)}`, { exact: true })

test.describe('weekly timesheet grid', () => {
  const mon = currentWeekStart()
  const tue = addDays(mon, 1)
  const thu = addDays(mon, 3)

  test('consultant fills and submits the current week', async ({ page }) => {
    const f = await newFirm('Grid Firm')
    await seed(f)
    await login(page, f.consultant.email)
    await page.goto(`/f/${f.firmId}`)
    await goTo(page, 'Work', 'My timesheet')
    await expect(page.getByRole('heading', { name: `Week of ${formatDayLabel(mon)}` })).toBeVisible()

    await hours(page, mon).fill('8')
    await note(page, mon).fill('Kickoff')
    await hours(page, tue).fill('7.5')
    await expect(page.getByTestId('week-total')).toHaveText('15.50')
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByRole('status')).toContainText('Saved')

    await page.reload()
    await expect(hours(page, mon)).toHaveValue('8.00')
    await expect(note(page, mon)).toHaveValue('Kickoff')
    await expect(hours(page, tue)).toHaveValue('7.50')
    await expect(page.getByTestId('week-total')).toHaveText('15.50')
    await expect(page.getByTestId('status')).toHaveText('Draft')

    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page.getByTestId('status')).toHaveText('Submitted')
    await expect(hours(page, mon)).toHaveAttribute('readonly', '')
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0)
  })

  test('assignment ending mid-week disables later days', async ({ page }) => {
    const f = await newFirm('Grid End Firm')
    await seed(f, { assignTo: addDays(mon, 2) })
    await login(page, f.consultant.email)
    await page.goto(`/f/${f.firmId}/timesheet`)
    await expect(hours(page, mon)).toBeEnabled()
    await expect(hours(page, thu)).toBeDisabled()
  })

  test('bad hours show a field error', async ({ page }) => {
    const f = await newFirm('Grid Bad Firm')
    await seed(f)
    await login(page, f.consultant.email)
    await page.goto(`/f/${f.firmId}/timesheet`)
    await hours(page, mon).fill('25')
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByText('Enter hours between 0.01 and 24, up to 2 decimal places.')).toBeVisible()
    await page.reload()
    await expect(hours(page, mon)).toHaveValue('')
  })

  test('no future weeks', async ({ page }) => {
    const f = await newFirm('Grid Future Firm')
    await seed(f)
    await login(page, f.consultant.email)
    await page.goto(`/f/${f.firmId}/timesheet`)
    await expect(page.getByRole('link', { name: 'Previous week' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Next week' })).toHaveCount(0)
    await page.goto(`/f/${f.firmId}/timesheet?week=${addDays(mon, 7)}`)
    await expect(page.getByRole('heading', { name: `Week of ${formatDayLabel(mon)}` })).toBeVisible()
  })

  test('unlinked user sees the not-linked message', async ({ page }) => {
    const f = await newFirm('Grid Unlinked Firm')
    await login(page, f.manager.email)
    await page.goto(`/f/${f.firmId}`)
    await goTo(page, 'Work', 'My timesheet')
    await expect(
      page.getByText("Your login isn't linked to a consultant record yet. Ask an Admin to link it."),
    ).toBeVisible()
  })

  test("consultant can't open another's timesheet", async ({ page }) => {
    const f = await newFirm('Grid Other Firm')
    const s = await seed(f)
    await login(page, f.consultant.email)
    const res = await page.goto(`/f/${f.firmId}/timesheet?consultant=${s.consultantId}`)
    expect(res?.status()).toBe(404)
  })

  test('no rates in source', async ({ page }) => {
    const f = await newFirm('Grid Rates Firm')
    await seed(f, { clientRate: '187.43', costRate: '91.27' })
    await login(page, f.consultant.email)
    await page.goto(`/f/${f.firmId}/timesheet`)
    await expect(hours(page, mon)).toBeVisible()
    const html = await page.content()
    expect(html).not.toContain('187.43')
    expect(html).not.toContain('91.27')
  })

  test('hours on days no longer assigned are read-only with a notice', async ({ page }) => {
    const f = await newFirm('Grid Stale Firm')
    const s = await seed(f)
    const db = adminDb()
    const { data: ts } = await db
      .from('timesheets')
      .insert({ firm_id: f.firmId, consultant_id: s.consultantId, week_start: mon })
      .select('id')
      .single()
    const { error } = await db.from('time_entries').insert({
      firm_id: f.firmId,
      timesheet_id: ts!.id,
      project_id: s.projectId,
      work_date: thu,
      hours: '3',
    })
    expect(error).toBeNull()
    // End the assignment after the entry exists, so Thursday is no longer an active day.
    await db
      .from('project_assignments')
      .update({ effective_to: addDays(mon, 2) })
      .eq('id', s.assignmentId)
    await login(page, f.consultant.email)
    await page.goto(`/f/${f.firmId}/timesheet`)
    await expect(
      page.getByText("Hours on days you're no longer assigned to will be removed when you save."),
    ).toBeVisible()
    await expect(hours(page, thu)).toBeDisabled()
    await expect(hours(page, thu)).toHaveValue('3.00')
  })
})

test.describe('manager timesheet review', () => {
  const mon = currentWeekStart()

  async function submitWeek(
    f: Awaited<ReturnType<typeof newFirm>>,
    s: Awaited<ReturnType<typeof seed>>,
    week: string,
    day: string,
    h = '8',
  ) {
    const entries = [{ projectId: s.projectId, workDate: day, hours: h, note: null }]
    const save = await f.consultant.db.rpc('save_timesheet_week', {
      p_firm: f.firmId,
      p_consultant: s.consultantId,
      p_week_start: week,
      p_entries: entries,
    })
    expect(save.error).toBeNull()
    const sub = await f.consultant.db.rpc('submit_timesheet', { p_timesheet: save.data as string })
    expect(sub.error).toBeNull()
    return save.data as string
  }

  test('manager rejects, consultant fixes, manager approves', async ({ browser }) => {
    const f = await newFirm('Review Firm')
    const s = await seed(f, { clientRate: '187.43', costRate: '91.27' })
    await submitWeek(f, s, mon, mon)

    const mPage = await (await browser.newContext()).newPage()
    await login(mPage, f.manager.email)
    await mPage.goto(`/f/${f.firmId}`)
    await goTo(mPage, 'Work', 'Timesheet approvals')
    const queue = mPage.getByRole('region', { name: 'Awaiting approval' })
    const row = queue.getByRole('row', { name: /Con Sultant/ })
    await expect(row).toBeVisible()
    await row.getByRole('link').first().click()
    await mPage.getByLabel('What needs to change?').fill('Split hours by task')
    await mPage.getByRole('button', { name: 'Reject' }).click()
    await expect(mPage.getByTestId('status')).toHaveText('Rejected')

    const cPage = await (await browser.newContext()).newPage()
    await login(cPage, f.consultant.email)
    await cPage.goto(`/f/${f.firmId}`)
    await goTo(cPage, 'Work', 'My timesheet')
    await expect(cPage.getByText('Changes requested:')).toBeVisible()
    await expect(cPage.getByText('Split hours by task')).toBeVisible()
    await expect(hours(cPage, mon)).toBeEditable()
    await hours(cPage, mon).fill('7.5')
    await cPage.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(cPage.getByTestId('status')).toHaveText('Submitted')

    await mPage.goto(`/f/${f.firmId}/timesheets`)
    await mPage
      .getByRole('region', { name: 'Awaiting approval' })
      .getByRole('link', { name: /Con Sultant/ })
      .click()
    await mPage.getByRole('button', { name: 'Approve' }).click()
    await expect(mPage.getByTestId('status')).toHaveText('Approved')
    await expect(mPage.getByText('187.43')).toBeVisible()
    await expect(mPage.getByText('91.27')).toBeVisible()

    await mPage.goto(`/f/${f.firmId}/timesheets`)
    const wk = mPage.getByRole('region', { name: 'Week status' })
    const wrow = wk.getByRole('row', { name: /Con Sultant/ })
    await expect(wrow).toContainText('Approved')
    await expect(wrow).toContainText('7.50')
  })

  test('cost rate missing shows a clear error', async ({ page }) => {
    const f = await newFirm('Review Cost Firm')
    const s = await seed(f, { costFrom: '2026-10-06' })
    const id = await submitWeek(f, s, PAST_WEEK, PAST_WEEK)
    await login(page, f.manager.email)
    await page.goto(`/f/${f.firmId}/timesheets/${id}`)
    await page.getByRole('button', { name: 'Approve' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'no cost rate' })).toContainText(
      'no cost rate for a day worked',
    )
    await expect(page.getByTestId('status')).toHaveText('Submitted')
  })

  test('reopen', async ({ page }) => {
    const f = await newFirm('Review Reopen Firm')
    const s = await seed(f)
    const id = await submitWeek(f, s, mon, mon)
    await login(page, f.manager.email)
    await page.goto(`/f/${f.firmId}/timesheets/${id}`)
    await page.getByRole('button', { name: 'Approve' }).click()
    await expect(page.getByTestId('status')).toHaveText('Approved')
    await page.getByRole('button', { name: 'Reopen' }).click()
    await expect(page.getByTestId('status')).toHaveText('Draft')
  })

  test('week status shows not started', async ({ page }) => {
    const f = await newFirm('Review Status Firm')
    await seed(f)
    const { error } = await adminDb()
      .from('consultants')
      .insert({
        firm_id: f.firmId,
        name: 'Newbie Nora',
        email: `n-${crypto.randomUUID()}@test.local`,
        type: 'employee',
      })
    expect(error).toBeNull()
    await login(page, f.manager.email)
    await page.goto(`/f/${f.firmId}/timesheets`)
    const row = page.getByRole('region', { name: 'Week status' }).getByRole('row', { name: /Newbie Nora/ })
    await expect(row).toContainText('Not started')
    await row.getByRole('link', { name: 'Enter time' }).click()
    await expect(page.getByRole('heading', { name: 'Timesheet: Newbie Nora' })).toBeVisible()
  })

  test('consultant gets 404 on /timesheets', async ({ page }) => {
    const f = await newFirm('Review 404 Firm')
    await seed(f)
    await login(page, f.consultant.email)
    const res = await page.goto(`/f/${f.firmId}/timesheets`)
    expect(res?.status()).toBe(404)
  })
})

test('manager dashboard shows the awaiting approval count and links to timesheets', async ({ page }) => {
  const f = await newFirm('Dash Firm')
  const s = await seedTimesheetFixture(f, { assignFrom: '2026-01-05' })
  const save = await f.consultant.db.rpc('save_timesheet_week', {
    p_firm: f.firmId,
    p_consultant: s.consultantId,
    p_week_start: PAST_WEEK,
    p_entries: [{ projectId: s.projectId, workDate: PAST_WEEK, hours: '8', note: null }],
  })
  expect(save.error).toBeNull()
  const sub = await f.consultant.db.rpc('submit_timesheet', { p_timesheet: save.data as string })
  expect(sub.error).toBeNull()
  await login(page, f.manager.email)
  await page.goto(`/f/${f.firmId}`)
  const card = page.getByTestId('awaiting-approval')
  await expect(card).toContainText('Awaiting approval')
  await expect(card.getByTestId('awaiting-approval-count')).toHaveText('1')
  await card.getByRole('link', { name: 'Awaiting approval' }).click()
  await expect(page).toHaveURL(new RegExp(`/f/${f.firmId}/timesheets$`))
})
