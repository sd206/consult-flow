/** Cap on the file names carried in `?filesRejected=` and shown back to the user. */
export const MAX_REJECTED_NAMES = 300

function cap(text: string): string {
  return Array.from(text).slice(0, MAX_REJECTED_NAMES).join('')
}

/** The `?filesRejected=` value: the rejected file names, comma-separated and capped. */
export function rejectedFilesParam(names: string[]): string {
  return cap(names.join(', '))
}

/**
 * The fixed notice for a `?filesRejected=` value, or null when there is none. Only the names come
 * from the URL; they are capped here and escaped by React when rendered.
 */
export function rejectedFilesNotice(param: string | string[] | undefined): string | null {
  if (typeof param !== 'string') return null
  const names = cap(param.replace(/[\u0000-\u001f\u007f]/g, '')).trim()
  return names ? `Expense saved, but some receipts weren't attached: ${names}.` : null
}
