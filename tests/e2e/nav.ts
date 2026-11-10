import type { Page } from '@playwright/test'

/** The firm's main menu. */
export const firmNav = (page: Page) => page.getByRole('navigation', { name: 'Firm' })

/** Opens a top-level menu group (Work, Billing, Reports, Setup). */
export async function openMenu(page: Page, group: string) {
  await firmNav(page).getByRole('button', { name: group }).click()
}

/** Opens a menu group and follows one of its links. */
export async function goTo(page: Page, group: string, item: string) {
  await openMenu(page, group)
  await firmNav(page).getByRole('link', { name: item, exact: true }).click()
}
