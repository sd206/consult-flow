import { test, expect, type Page } from '@playwright/test'
import { newFirm, TEST_PASSWORD } from '../integration/helpers'

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54424'
type MailpitList = { messages: { ID: string }[] }
type MailpitMessage = { HTML: string; Subject: string }

async function emailLink(to: string): Promise<string> {
  let id: string | undefined
  await expect
    .poll(async () => {
      const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
      id = ((await res.json()) as MailpitList).messages[0]?.ID
      return id
    })
    .toBeTruthy()
  const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as MailpitMessage
  const href = msg.HTML.match(/href="([^"]+)"/)?.[1]
  if (!href) throw new Error(`no link in email "${msg.Subject}"`)
  return href.replace(/&amp;/g, '&')
}

async function login(page: Page, email: string, password = TEST_PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const accountMenu = (page: Page) => page.getByRole('button', { name: /^Account/ })

test('the account menu shows who is signed in and signs out', async ({ page }) => {
  const f = await newFirm('Account Menu Firm')
  await login(page, f.manager.email)
  await page.goto(`/f/${f.firmId}`)
  await accountMenu(page).click()
  await expect(page.getByText(f.manager.email, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login\?signedOut=1$/)
  await expect(page.getByRole('status')).toHaveText("You've signed out.")
  await page.goto(`/f/${f.firmId}`)
  await expect(page).toHaveURL(/\/login/)
})

test('a signed-in user changes their password from the account menu', async ({ page }) => {
  const f = await newFirm('Change Password Firm')
  await login(page, f.consultant.email)
  await page.goto(`/f/${f.firmId}`)
  await accountMenu(page).click()
  await page.getByRole('link', { name: 'Change password' }).click()
  await expect(page.getByRole('heading', { name: 'Change your password' })).toBeVisible()
  await page.getByLabel('New password').fill('a-changed-password-1')
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page).not.toHaveURL(/set-password/)

  await accountMenu(page).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
  await login(page, f.consultant.email, 'a-changed-password-1')
})

test('forgot password emails a reset link that leads to setting a new password', async ({ page }) => {
  const f = await newFirm('Forgot Password Firm')
  await page.goto('/login')
  await page.getByLabel('Email').fill(f.admin.email)
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('status')).toHaveText('If that email has an account, a password reset link is on its way.')

  const link = await emailLink(f.admin.email)
  expect(link).toMatch(/\/auth\/confirm\?token_hash=[^&]+&type=recovery$/)
  await page.goto(link)
  await expect(page).toHaveURL(/\/auth\/set-password$/)
  await page.getByLabel('New password').fill('a-reset-password-1')
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page).toHaveURL(new RegExp(`/f/${f.firmId}$`))

  await page.context().clearCookies()
  await login(page, f.admin.email, 'a-reset-password-1')
})

test('forgot password asks for the email first', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'email' })).toHaveText('Enter your email first.')
})
