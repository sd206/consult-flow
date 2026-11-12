'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireFirmRole } from '@/lib/auth/context'
import { fieldErrorsOf, type FormResult, str } from '@/lib/form'
import { fail, type Result } from '@/lib/result'
import {
  confirmExpense,
  confirmOtherIncome,
  confirmPayment,
  createAccount,
  getAccount,
  getCandidates,
  ignoreLines,
  importStatement,
  linkLine,
  markDuplicates,
  resetLine,
  saveCsvMapping,
  setAccountActive,
  updateAccount,
  type Candidates,
  type ImportOutcome,
} from './data'
import { readCsv } from './csv'
import { payeeFromDescription } from './filter'
import { statementFormat } from './parse'
import {
  accountSchema,
  csvMappingSchema,
  expenseConfirmSchema,
  otherIncomeConfirmSchema,
  paymentConfirmSchema,
} from './schemas'

const MANAGERS = ['admin', 'manager'] as const
const MAX_BYTES = 5 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function revalidate(firmId: string, accountId?: string) {
  revalidatePath(`/f/${firmId}/bank`)
  if (accountId) revalidatePath(`/f/${firmId}/bank/${accountId}`)
}

function accountFields(fd: FormData) {
  return { name: str(fd, 'name'), kind: str(fd, 'kind'), last4: str(fd, 'last4') }
}

export async function createAccountAction(firmId: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = accountSchema.safeParse(accountFields(formData))
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const r = await createAccount(db, firmId, parsed.data)
  if (!r.ok) return r
  revalidate(firmId)
  redirect(`/f/${firmId}/bank/${r.data.id}`)
}

export async function updateAccountAction(firmId: string, accountId: string, formData: FormData): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = accountSchema.safeParse(accountFields(formData))
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const r = await updateAccount(db, firmId, accountId, parsed.data)
  if (r.ok) revalidate(firmId, accountId)
  return r
}

export async function setAccountActiveAction(firmId: string, accountId: string, active: boolean): Promise<Result<void>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const r = await setAccountActive(db, firmId, accountId, active)
  if (r.ok) revalidate(firmId, accountId)
  return r
}

async function readUpload(formData: FormData): Promise<Result<{ name: string; text: string }>> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return fail('Choose a statement file.')
  if (file.size > MAX_BYTES) return fail('This file is larger than 5 MB.')
  if (!statementFormat(file.name)) return fail('Upload an OFX, QFX or CSV file.')
  return { ok: true, data: { name: file.name, text: await file.text() } }
}

export type CsvPreview = { needsMapping: true; header: string[]; rows: string[][] }

/**
 * Imports a statement. A CSV for an account with no saved mapping (or when
 * a mapping is sent with the upload) returns a preview first unless `mapping` is given.
 */
export async function uploadStatementAction(
  firmId: string,
  accountId: string,
  formData: FormData,
): Promise<Result<ImportOutcome | CsvPreview>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const account = await getAccount(db, firmId, accountId)
  if (!account.ok) return account
  const file = await readUpload(formData)
  if (!file.ok) return file

  let mapping = account.data.csvMapping
  const sent = str(formData, 'mapping')
  if (statementFormat(file.data.name) === 'csv') {
    if (sent) {
      let raw: unknown
      try {
        raw = JSON.parse(sent)
      } catch {
        return fail('Choose which columns hold the date, description and amount.')
      }
      const m = csvMappingSchema.safeParse(raw)
      if (!m.success) return fail(m.error.issues[0]?.message ?? 'Check the column choices.')
      mapping = m.data
      const saved = await saveCsvMapping(db, accountId, mapping)
      if (!saved.ok) return saved
    } else if (!mapping || str(formData, 'remap') === '1') {
      const rows = readCsv(file.data.text)
      if (rows.length < 2) return fail('No transactions found in this file.')
      return { ok: true, data: { needsMapping: true, header: rows[0], rows: rows.slice(1, 6) } }
    }
  }

  const r = await importStatement(db, accountId, file.data.name, file.data.text, mapping)
  if (r.ok) revalidate(firmId, accountId)
  return r
}

export async function candidatesAction(
  firmId: string,
  line: { id: string; description: string; amount: string },
): Promise<Result<Candidates>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  if (!UUID.test(line.id)) return fail('Bank line not found.')
  return getCandidates(db, line)
}

export async function confirmPaymentAction(
  firmId: string,
  accountId: string,
  lineId: string,
  formData: FormData,
): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = paymentConfirmSchema.safeParse({ invoiceId: str(formData, 'invoiceId'), notes: str(formData, 'notes') })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const r = await confirmPayment(db, lineId, parsed.data.invoiceId, parsed.data.notes)
  revalidate(firmId, accountId)
  if (r.ok) revalidatePath(`/f/${firmId}/invoices/${parsed.data.invoiceId}`)
  return r.ok ? { ok: true, data: undefined } : r
}

export async function confirmExpenseAction(
  firmId: string,
  accountId: string,
  lineId: string,
  formData: FormData,
): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = expenseConfirmSchema.safeParse({
    payee: str(formData, 'payee'),
    categoryId: str(formData, 'categoryId'),
    clientId: str(formData, 'clientId'),
    projectId: str(formData, 'projectId'),
    notes: str(formData, 'notes'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const r = await confirmExpense(db, lineId, parsed.data)
  revalidate(firmId, accountId)
  if (r.ok) revalidatePath(`/f/${firmId}/expenses`)
  return r.ok ? { ok: true, data: undefined } : r
}

export async function confirmOtherIncomeAction(
  firmId: string,
  accountId: string,
  lineId: string,
  formData: FormData,
): Promise<FormResult> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const parsed = otherIncomeConfirmSchema.safeParse({
    source: str(formData, 'source'),
    categoryId: str(formData, 'categoryId'),
    notes: str(formData, 'notes'),
  })
  if (!parsed.success) return fieldErrorsOf(parsed.error)
  const r = await confirmOtherIncome(db, lineId, parsed.data)
  revalidate(firmId, accountId)
  if (r.ok) revalidatePath(`/f/${firmId}/other-income`)
  return r.ok ? { ok: true, data: undefined } : r
}

async function loadLines(db: Awaited<ReturnType<typeof requireFirmRole>>['db'], ids: string[]) {
  const clean = ids.filter((id) => UUID.test(id)).slice(0, 500)
  if (clean.length === 0) return new Map<string, { description: string; amount: string }>()
  const { data } = await db.from('bank_lines').select('id, description, amount::text').in('id', clean).eq('status', 'new')
  return new Map(((data ?? []) as { id: string; description: string; amount: string }[]).map((l) => [l.id, l]))
}

export type BulkOutcome = { recorded: number; failed: number; reasons: string[] }

/** Records each line as an expense or other income, one at a time; lines that fail stay in review. */
async function recordAll(
  db: Awaited<ReturnType<typeof requireFirmRole>>['db'],
  jobs: { lineId: string; run: (payee: string) => Promise<Result<string>> }[],
): Promise<BulkOutcome> {
  const lines = await loadLines(db, jobs.map((j) => j.lineId))
  const out: BulkOutcome = { recorded: 0, failed: 0, reasons: [] }
  for (const job of jobs.slice(0, 500)) {
    const line = lines.get(job.lineId)
    const r = line ? await job.run(payeeFromDescription(line.description)) : fail('This line was already handled.')
    if (r.ok) out.recorded++
    else {
      out.failed++
      if (!out.reasons.includes(r.error)) out.reasons.push(r.error)
    }
  }
  return out
}

/** Bulk "Confirm suggested": each money-out line becomes an expense with its suggested category. */
export async function confirmSuggestedAction(
  firmId: string,
  accountId: string,
  items: { lineId: string; categoryId: string }[],
): Promise<Result<BulkOutcome>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const out = await recordAll(
    db,
    items.map((it) => ({
      lineId: it.lineId,
      run: async (payee) => {
        const parsed = expenseConfirmSchema.safeParse({ payee, categoryId: it.categoryId, clientId: '', projectId: '', notes: '' })
        return parsed.success ? confirmExpense(db, it.lineId, parsed.data) : fail(parsed.error.issues[0]?.message ?? 'Choose a category.')
      },
    })),
  )
  revalidate(firmId, accountId)
  revalidatePath(`/f/${firmId}/expenses`)
  return { ok: true, data: out }
}

/** Bulk "Categorise": money-out lines become expenses, money-in lines other income, with the chosen categories. */
export async function bulkCategoriseAction(
  firmId: string,
  accountId: string,
  input: {
    expenseLineIds: string[]
    expenseCategoryId: string
    clientId: string
    projectId: string
    incomeLineIds: string[]
    incomeCategoryId: string
  },
): Promise<Result<BulkOutcome>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const expenseJobs = input.expenseLineIds.map((lineId) => ({
    lineId,
    run: async (payee: string): Promise<Result<string>> => {
      const parsed = expenseConfirmSchema.safeParse({
        payee,
        categoryId: input.expenseCategoryId,
        clientId: input.clientId,
        projectId: input.projectId,
        notes: '',
      })
      return parsed.success ? confirmExpense(db, lineId, parsed.data) : fail(parsed.error.issues[0]?.message ?? 'Choose a category.')
    },
  }))
  const incomeJobs = input.incomeLineIds.map((lineId) => ({
    lineId,
    run: async (source: string): Promise<Result<string>> => {
      const parsed = otherIncomeConfirmSchema.safeParse({ source, categoryId: input.incomeCategoryId, notes: '' })
      return parsed.success ? confirmOtherIncome(db, lineId, parsed.data) : fail(parsed.error.issues[0]?.message ?? 'Choose a category.')
    },
  }))
  const out = await recordAll(db, [...expenseJobs, ...incomeJobs])
  revalidate(firmId, accountId)
  revalidatePath(`/f/${firmId}/expenses`)
  revalidatePath(`/f/${firmId}/other-income`)
  return { ok: true, data: out }
}

/** Bulk "Mark as duplicate": link to the one matching entry, otherwise ignore as "Duplicate". */
export async function markDuplicatesAction(
  firmId: string,
  accountId: string,
  lineIds: string[],
): Promise<Result<{ matched: number; ignored: number; skipped: number }>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const r = await markDuplicates(db, lineIds.filter((id) => UUID.test(id)).slice(0, 500))
  revalidate(firmId, accountId)
  return r
}

export async function linkLineAction(
  firmId: string,
  accountId: string,
  lineId: string,
  target: { paymentId: string } | { expenseId: string },
): Promise<Result<void>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const r = await linkLine(db, lineId, target)
  revalidate(firmId, accountId)
  return r
}

export async function ignoreLinesAction(
  firmId: string,
  accountId: string,
  lineIds: string[],
  reason: string,
): Promise<Result<number>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const ids = lineIds.filter((id) => UUID.test(id)).slice(0, 500)
  const r = await ignoreLines(db, ids, reason.trim().slice(0, 200) || null)
  revalidate(firmId, accountId)
  return r
}

export async function resetLineAction(firmId: string, accountId: string, lineId: string): Promise<Result<void>> {
  const { db } = await requireFirmRole(firmId, [...MANAGERS])
  const r = await resetLine(db, lineId)
  revalidate(firmId, accountId)
  return r
}
