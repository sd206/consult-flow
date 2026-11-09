import { describe, expect, it } from 'vitest'
import { parseWeekForm } from './schemas'

const MON = '2026-10-05'
const TUE = '2026-10-06'
const cells = [
  { projectId: 'P', workDate: MON },
  { projectId: 'P', workDate: TUE },
]

function form(values: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(values)) fd.set(k, v)
  return fd
}

function errorsOf(r: ReturnType<typeof parseWeekForm>): Record<string, string | undefined> {
  return r.ok ? {} : (r.fieldErrors ?? {})
}

describe('parseWeekForm', () => {
  it('builds entries and skips blank hours', () => {
    const r = parseWeekForm(form({ [`h:P:${MON}`]: '8', [`n:P:${MON}`]: ' Kickoff ', [`h:P:${TUE}`]: '' }), cells)
    expect(r).toEqual({ ok: true, data: [{ projectId: 'P', workDate: MON, hours: '8.00', note: 'Kickoff' }] })
  })

  it('rejects a note without hours', () => {
    const r = parseWeekForm(form({ [`n:P:${TUE}`]: 'x' }), cells)
    expect(r.ok).toBe(false)
    expect(errorsOf(r)).toEqual({ [`n:P:${TUE}`]: 'Add hours for this note.' })
  })

  it('rejects hours over 24 on the h: key', () => {
    const r = parseWeekForm(form({ [`h:P:${MON}`]: '25' }), cells)
    expect(r.ok).toBe(false)
    expect(Object.keys(errorsOf(r))).toEqual([`h:P:${MON}`])
  })

  it('rejects notes over 500 characters', () => {
    const r = parseWeekForm(form({ [`h:P:${MON}`]: '1', [`n:P:${MON}`]: 'a'.repeat(501) }), cells)
    expect(errorsOf(r)[`n:P:${MON}`]).toBe('Keep notes to 500 characters or fewer.')
  })
})
