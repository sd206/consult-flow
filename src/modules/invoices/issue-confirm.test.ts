import { describe, expect, it } from 'vitest'
import { issueConfirmText } from './issue-confirm'

describe('issueConfirmText', () => {
  it('names both dates', () => {
    expect(issueConfirmText('2026-11-09', '2026-12-09', '2026-11-09')).toBe(
      "Issue this invoice dated 9 Nov 2026 and due 9 Dec 2026? It gets the next number and can't be edited afterwards.",
    )
  })
  it('warns when the issue date is before today', () => {
    expect(issueConfirmText('2026-11-08', '2026-12-08', '2026-11-09')).toBe(
      "The issue date is in the past. Issue this invoice dated 8 Nov 2026 and due 8 Dec 2026? It gets the next number and can't be edited afterwards.",
    )
  })
  it('does not warn for a future issue date', () => {
    expect(issueConfirmText('2026-11-10', '2026-11-10', '2026-11-09').startsWith('Issue this invoice')).toBe(true)
  })
})
