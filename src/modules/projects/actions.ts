'use server'

import { revalidatePath } from 'next/cache'
import { requireFirmRole } from '@/lib/auth/context'
import { fieldErrorsOf, type FormResult, str } from '@/lib/form'
import { addAssignment, changeClientRate, createProject, endAssignment, updateProject } from './data'
import { assignmentSchema, changeRateSchema, endAssignmentSchema, projectSchema } from './schemas'

const MANAGERS = ['admin', 'manager'] as const

function done<T>(firmId: string, result: FormResult<T>, projectId?: string): FormResult<T> {
  if (result.ok) {
    revalidatePath(`/f/${firmId}/projects`)
    if (projectId) revalidatePath(`/f/${firmId}/projects/${projectId}`)
  }
  return result
}

function parseProject(formData: FormData) {
  return projectSchema.safeParse({
    clientId: str(formData, 'clientId'),
    name: str(formData, 'name'),
    code: str(formData, 'code'),
    status: str(formData, 'status'),
    startDate: str(formData, 'startDate'),
    endDate: str(formData, 'endDate'),
  })
}

export async function createProjectAction(firmId: string, formData: FormData): Promise<FormResult<{ id: string }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = parseProject(formData)
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, await createProject(db, firmId, parsed.data))
}

export async function updateProjectAction(firmId: string, id: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = parseProject(formData)
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, await updateProject(db, firmId, id, parsed.data), id)
}

export async function addAssignmentAction(
  firmId: string,
  projectId: string,
  formData: FormData,
): Promise<FormResult<{ id: string }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = assignmentSchema.safeParse({
    consultantId: str(formData, 'consultantId'),
    clientRate: str(formData, 'clientRate'),
    effectiveFrom: str(formData, 'effectiveFrom'),
    effectiveTo: str(formData, 'effectiveTo'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const { effectiveTo, ...rest } = parsed.data
  return done(
    firmId,
    await addAssignment(db, firmId, { projectId, ...rest, effectiveTo: effectiveTo || null }),
    projectId,
  )
}

export async function changeClientRateAction(
  firmId: string,
  projectId: string,
  assignmentId: string,
  formData: FormData,
): Promise<FormResult<{ id: string }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = changeRateSchema.safeParse({
    clientRate: str(formData, 'clientRate'),
    effectiveFrom: str(formData, 'effectiveFrom'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, await changeClientRate(db, firmId, assignmentId, parsed.data), projectId)
}

export async function endAssignmentAction(
  firmId: string,
  projectId: string,
  assignmentId: string,
  formData: FormData,
): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = endAssignmentSchema.safeParse({ effectiveTo: str(formData, 'effectiveTo') })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  return done(firmId, await endAssignment(db, firmId, assignmentId, parsed.data.effectiveTo), projectId)
}
