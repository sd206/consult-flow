/** Only same-origin relative paths are allowed as post-login targets. */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/'
  if (next.includes(String.fromCharCode(92))) return '/'
  return next
}
