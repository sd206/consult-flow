import { test, expect, type Page } from '@playwright/test'
import { firmNav } from './nav'
import { newFirm, TEST_PASSWORD } from '../integration/helpers'

// Local Supabase delivers auth email to Mailpit (supabase/config.toml [inbucket]).
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54424'

type MailpitList = { messages: { ID: string }[] }
type MailpitMessage = { HTML: string; Subject: string }

/** The link in the newest email to `to`. Waits (polling Mailpit) for the email to arrive. */
async function emailLink(to: string): Promise<string> {
  let id: string | undefined
  await expect
    .poll(async () => {
      const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
      const list = (await res.json()) as MailpitList
      id = list.messages[0]?.ID
      return id
    })
    .toBeTruthy()
  const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as MailpitMessage
  const href = msg.HTML.match(/href="([^"]+)"/)?.[1]
  if (!href) throw new Error(`no link in email "${msg.Subject}"`)
  return href.replace(/&amp;/g, '&')
}

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test('invited new user follows the email link, sets a password and lands in the firm', async ({ page }) => {
  const f = await newFirm('Invite Link Firm')
  await login(page, f.admin.email)
  await page.goto(`/f/${f.firmId}/users`)
  const email = `invitee-${crypto.randomUUID()}@test.local`
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Role', { exact: true }).selectOption('consultant')
  await page.getByRole('button', { name: 'Invite' }).click()
  await expect(page.getByRole('status')).toContainText('Invitation sent')
  await page.context().clearCookies()

  const link = await emailLink(email)
  expect(link).toMatch(/^http:\/\/localhost:3000\/auth\/confirm\?token_hash=[^&]+&type=invite$/)

  await page.goto(link)
  await expect(page).toHaveURL(/\/auth\/set-password$/)
  await page.getByLabel('New password').fill('a-brand-new-password')
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page).toHaveURL(new RegExp(`/f/${f.firmId}$`))
  await expect(firmNav(page).getByRole('button', { name: 'Work' })).toBeVisible()

  // The link is single use.
  await page.context().clearCookies()
  await page.goto(link)
  await expect(page).toHaveURL(/\/login\?error=link$/)
  await expect(page.getByText('That sign-in link is invalid or has expired.')).toBeVisible()
})

test('existing user signs in with an emailed magic link', async ({ page }) => {
  const f = await newFirm('Magic Link Firm')
  await page.goto('/login')
  await page.getByLabel('Email').fill(f.consultant.email)
  await page.getByRole('button', { name: 'Email me a link' }).click()
  await expect(page.getByRole('status')).toContainText('If that email has an account')

  const link = await emailLink(f.consultant.email)
  expect(link).toMatch(/^http:\/\/localhost:3000\/auth\/confirm\?token_hash=[^&]+&type=magiclink$/)

  await page.goto(link)
  await expect(page).toHaveURL(new RegExp(`/f/${f.firmId}$`))
  await expect(firmNav(page).getByRole('button', { name: 'Work' })).toBeVisible()
})

test('confirm links with a bad token or type go to the login error', async ({ page }) => {
  for (const query of ['token_hash=nope&type=invite', 'token_hash=nope&type=signup', 'type=magiclink']) {
    await page.goto(`/auth/confirm?${query}`)
    await expect(page).toHaveURL(/\/login\?error=link$/)
  }
  await expect(page.getByText('That sign-in link is invalid or has expired.')).toBeVisible()
})

test('adding an existing user emails them a sign-in link', async ({ page }) => {
  const f = await newFirm('Added Existing Firm')
  const other = await newFirm('Added Existing Other')
  await login(page, f.admin.email)
  await page.goto(`/f/${f.firmId}/users`)
  await page.getByLabel('Email', { exact: true }).fill(other.manager.email)
  await page.getByLabel('Role', { exact: true }).selectOption('manager')
  await page.getByRole('button', { name: 'Invite' }).click()
  await expect(page.getByRole('status')).toHaveText('Existing user added to this firm. We emailed them a sign-in link.')
  const link = await emailLink(other.manager.email)
  expect(link).toMatch(/\/auth\/confirm\?token_hash=[^&]+&type=magiclink$/)
})

test('an invitation that was never accepted can be sent again', async ({ page }) => {
  const f = await newFirm('Resend Invite Firm')
  await login(page, f.admin.email)
  await page.goto(`/f/${f.firmId}/users`)
  const email = `resend-${crypto.randomUUID()}@test.local`
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Role', { exact: true }).selectOption('manager')
  await page.getByRole('button', { name: 'Invite' }).click()
  await expect(page.getByRole('status')).toHaveText('Invitation sent.')
  await emailLink(email)

  await page.reload()
  const row = page.getByRole('row').filter({ hasText: email })
  await expect(row).toContainText('Invitation not accepted yet')
  await row.getByRole('button', { name: /^Resend invitation/ }).click()
  await expect(row.getByRole('status')).toHaveText('Invitation sent again.')
  await expect
    .poll(async () => {
      const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
      return ((await res.json()) as MailpitList).messages.length
    })
    .toBe(2)

  // Accepting the resent invitation works.
  await page.context().clearCookies()
  const link = await emailLink(email)
  expect(link).toMatch(/type=invite$/)
  await page.goto(link)
  await expect(page).toHaveURL(/\/auth\/set-password$/)
})
