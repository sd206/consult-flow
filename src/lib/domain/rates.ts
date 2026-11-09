export type DatedRate = { rate: string; effectiveFrom: string; effectiveTo?: string | null }

/** Latest rate with effectiveFrom <= date whose effectiveTo is null or >= date. ISO dates compare lexically. */
export function rateOn<T extends DatedRate>(rates: T[], date: string): T | null {
  let best: T | null = null
  for (const r of rates) {
    if (r.effectiveFrom > date) continue
    if (r.effectiveTo != null && r.effectiveTo < date) continue
    if (best === null || r.effectiveFrom > best.effectiveFrom) best = r
  }
  return best
}
