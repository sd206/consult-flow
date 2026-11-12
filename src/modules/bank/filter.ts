import { cleanDescription } from './clean'

export type Direction = 'all' | 'in' | 'out'

/** Lines whose description contains `text` (case-insensitive) and that go the chosen way. */
export function filterLines<T extends { amount: string; description: string }>(lines: T[], text: string, direction: Direction): T[] {
  const q = text.trim().replace(/\s+/g, ' ').toLowerCase()
  return lines.filter((l) => {
    const out = l.amount.startsWith('-')
    if (direction === 'in' && out) return false
    if (direction === 'out' && !out) return false
    return q === '' || l.description.replace(/\s+/g, ' ').toLowerCase().includes(q)
  })
}

/** Default payee or source for a bank line: the cleaned first part of the description, else the raw text. */
export function payeeFromDescription(description: string): string {
  const first = description.split(' – ')[0]
  return (cleanDescription(first) || description.trim()).slice(0, 120)
}
