import { describe, expect, it } from 'vitest'
import { selectionSummary } from './selection-summary'

const clients = { all: 'All clients', plural: 'clients' }

describe('selectionSummary', () => {
  it('shows the "all" text when nothing is ticked', () => {
    expect(selectionSummary([], clients)).toBe('All clients')
  })

  it('shows the name when one option is ticked', () => {
    expect(selectionSummary(['Globex'], clients)).toBe('Globex')
    expect(selectionSummary(['Portal'], { all: 'All projects', plural: 'projects' })).toBe('Portal')
  })

  it('shows a count when several are ticked', () => {
    expect(selectionSummary(['Globex', 'Initech'], clients)).toBe('2 clients')
    expect(selectionSummary(['a', 'b', 'c'], { all: 'All projects', plural: 'projects' })).toBe('3 projects')
  })
})
