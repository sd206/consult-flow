/**
 * A stable form of a bank description for matching ("AWS" → Software next time):
 * drops card-terminal noise (store numbers, reference tokens, short dates),
 * collapses spaces, upper-cases, at most 80 characters.
 */
export function cleanDescription(s: string): string {
  return s
    .toUpperCase()
    .replace(/\*[A-Z0-9]*\d[A-Z0-9]*/g, ' ')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}
