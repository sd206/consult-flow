import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEMPLATE_OPTIONS,
  parseTemplateOptions,
  templateInputSchema,
  templateOptionsSchema,
} from './schemas'

describe('templateOptionsSchema', () => {
  it('fills defaults for {}', () => {
    expect(templateOptionsSchema.parse({})).toEqual(DEFAULT_TEMPLATE_OPTIONS)
  })
  it('rejects a bad colour with the message', () => {
    const r = templateOptionsSchema.safeParse({ accentColor: 'red' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('Use a colour like #1F2937.')
  })
  it('rejects a 501-char footer', () => {
    const r = templateOptionsSchema.safeParse({ footerText: 'x'.repeat(501) })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('Keep this to 500 characters or fewer.')
  })
  it('trims text fields', () => {
    expect(templateOptionsSchema.parse({ footerText: '  hi  ' }).footerText).toBe('hi')
  })
})

describe('parseTemplateOptions', () => {
  it('falls back per key', () => {
    expect(parseTemplateOptions({ accentColor: 'bad', showRate: false })).toEqual({
      ...DEFAULT_TEMPLATE_OPTIONS,
      showRate: false,
    })
  })
  it('returns defaults for non-objects', () => {
    expect(parseTemplateOptions(null)).toEqual(DEFAULT_TEMPLATE_OPTIONS)
    expect(parseTemplateOptions('x')).toEqual(DEFAULT_TEMPLATE_OPTIONS)
  })
})

describe('templateInputSchema', () => {
  it('requires a name', () => {
    const r = templateInputSchema.safeParse({ name: ' ', baseLayout: 'classic', options: {} })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('Enter a template name.')
  })
  it('accepts valid input', () => {
    const r = templateInputSchema.parse({ name: ' Std ', baseLayout: 'modern', options: {} })
    expect(r.name).toBe('Std')
    expect(r.options).toEqual(DEFAULT_TEMPLATE_OPTIONS)
  })
})
