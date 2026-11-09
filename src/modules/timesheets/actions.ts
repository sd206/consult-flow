'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireFirmRole } from '@/lib/auth/context'
import { fieldErrorsOf, type FormResult, str } from '@/lib/form'
import {
  approveTimesheet,
  getTimesheetWeek,
  rejectTimesheet,
  reopenTimesheet,
  saveTimesheetWeek,
  submitTimesheet,
} from './data'
import { parseWeekForm } from './schemas'

const ALL_ROLES = ['admin', 'manager', 'consultant'] as const
const MANAGERS = ['admin', 'manager'] as const

const rejectSchema = z.object({
  comment: z.string().trim().min(1, 'Add a comment saying what needs to change.'),
})

function done<T>(firmId: string, result: FormResult<T>): FormResult<T> {
  if (result.ok) {
    revalidatePath(`/f/${firmId}/timesheet`)
    revalidatePath(`/f/${firmId}/timesheets`)
  }
  return result
}

/** Parse the form against cells derived from the server-side week (never from the client). */
async function saveFromForm(
  db: Parameters<typeof getTimesheetWeek>[0],
  firmId: string,
  consultantId: string,
  weekStart: string,
  formData: FormData,
): Promise<FormResult<{ timesheetId: string }>> {
  const week = await getTimesheetWeek(db, firmId, consultantId, weekStart)
  if (!week.ok) return week
  const cells = week.data.projects.flatMap((p) => p.activeDays.map((workDate) => ({ projectId: p.projectId, workDate })))
  const parsed = parseWeekForm(formData, cells)
  if (!parsed.ok) return parsed
  return saveTimesheetWeek(db, firmId, consultantId, weekStart, parsed.data)
}

export async function saveWeekAction(
  firmId: string,
  consultantId: string,
  weekStart: string,
  formData: FormData,
): Promise<FormResult<{ timesheetId: string }>> {
  const { db } = await requireFirmRole(firmId, [...ALL_ROLES])
  return done(firmId, await saveFromForm(db, firmId, consultantId, weekStart, formData))
}

export async function submitWeekAction(
  firmId: string,
  consultantId: string,
  weekStart: string,
  formData: FormData,
): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...ALL_ROLES])
  const saved = await saveFromForm(db, firmId, consultantId, weekStart, formData)
  if (!saved.ok) return saved
  return done(firmId, await submitTimesheet(db, firmId, saved.data.timesheetId))
}

export async function approveAction(firmId: string, timesheetId: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  return done(firmId, await approveTimesheet(db, firmId, timesheetId))
}

export async function rejectAction(firmId: string, timesheetId: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = rejectSchema.safeParse({ comment: str(formData, 'comment') })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, await rejectTimesheet(db, firmId, timesheetId, parsed.data.comment))
}

export async function reopenAction(firmId: string, timesheetId: string): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  return done(firmId, await reopenTimesheet(db, firmId, timesheetId))
}
