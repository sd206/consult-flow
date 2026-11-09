import { formatPdfDate } from './pdf/view-model'

/** The issue confirmation. Warns (never changes the date) when the issue date is before today (UTC). */
export function issueConfirmText(
  issueDate: string,
  dueDate: string,
  today: string = new Date().toISOString().slice(0, 10),
): string {
  const past = issueDate < today ? 'The issue date is in the past. ' : ''
  return `${past}Issue this invoice dated ${formatPdfDate(issueDate)} and due ${formatPdfDate(dueDate)}? It gets the next number and can't be edited afterwards.`
}
