export type InvoiceCandidate = { id: string; number: string; client_name: string; balance_due: string }

function words(s: string): string[] {
  return s
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
}

/** True when the client name's first word appears as a whole word in the description. */
function mentions(description: string, clientName: string): boolean {
  const d = words(description)
  const c = words(clientName)
  if (c.length === 0) return false
  // Bank descriptions often shorten names ("GLOBEX CORP"), so the first word is enough.
  return d.includes(c[0])
}

/**
 * Orders open invoices for a deposit: exact balance and client named in the
 * description first, then exact balance, then the rest; ties by invoice number.
 */
export function rankInvoices<T extends InvoiceCandidate>(description: string, invoices: T[], amount: string): T[] {
  const tier = (i: T) => {
    const exact = Number(i.balance_due) === Number(amount)
    if (exact && mentions(description, i.client_name)) return 0
    if (exact) return 1
    return 2
  }
  return [...invoices].sort((a, b) => tier(a) - tier(b) || a.number.localeCompare(b.number))
}
