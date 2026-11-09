/** Public site origin, used to build auth redirect links. Throws if not configured. */
export function siteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL
  if (!url) throw new Error('NEXT_PUBLIC_SITE_URL is not set')
  return url.replace(/\/+$/, '')
}
