import { expect, type Page } from '@playwright/test'

/** Answers the in-page confirm dialog and returns its message. */
export async function answerConfirm(page: Page, accept = true): Promise<string> {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  const message = (await dialog.getByTestId('confirm-message').textContent()) ?? ''
  if (accept) await dialog.getByTestId('confirm-ok').click()
  else await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  return message
}
