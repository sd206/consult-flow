import { CHECK_FIELDS, type FieldErrors, type FormResult, str } from '@/lib/form'
import { parseHours } from '@/lib/domain/hours'
import type { EntryInput } from './data'

const NOTE_MAX = 500

/** Reads `h:{projectId}:{workDate}` and `n:{projectId}:{workDate}` fields for the given cells only. */
export function parseWeekForm(
  formData: FormData,
  cells: { projectId: string; workDate: string }[],
): FormResult<EntryInput[]> {
  const entries: EntryInput[] = []
  const fieldErrors: FieldErrors = {}
  for (const { projectId, workDate } of cells) {
    const hKey = `h:${projectId}:${workDate}`
    const nKey = `n:${projectId}:${workDate}`
    const rawHours = str(formData, hKey).trim()
    const note = str(formData, nKey).trim()
    if (note.length > NOTE_MAX) fieldErrors[nKey] = 'Keep notes to 500 characters or fewer.'
    if (rawHours === '') {
      if (note && !fieldErrors[nKey]) fieldErrors[nKey] = 'Add hours for this note.'
      continue
    }
    const hours = parseHours(rawHours)
    if (!hours.ok) {
      fieldErrors[hKey] = hours.error
      continue
    }
    entries.push({ projectId, workDate, hours: hours.data, note: note === '' ? null : note })
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, error: CHECK_FIELDS, fieldErrors }
  return { ok: true, data: entries }
}
