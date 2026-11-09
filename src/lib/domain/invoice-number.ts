/** Formats an invoice number. Assumes `pattern` already passed validateInvoicePattern; issueDate is YYYY-MM-DD. */
export function formatInvoiceNumber(pattern: string, seq: number, issueDate: string): string {
  const [yyyy, mm] = issueDate.split('-')
  return pattern.replace(/\{(YYYY|YY|MM|SEQ:(\d+))\}/g, (_m, token: string, width?: string) => {
    if (token === 'YYYY') return yyyy
    if (token === 'YY') return yyyy.slice(2)
    if (token === 'MM') return mm
    return String(seq).padStart(Number(width), '0')
  })
}
