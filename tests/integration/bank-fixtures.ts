import { createHash } from 'node:crypto'
import type { newFirm } from './helpers'

type Firm = Awaited<ReturnType<typeof newFirm>>

export type LineInput = { posted_on: string; amount: string; description: string; bank_ref?: string | null }

export async function makeAccount(f: Firm, kind: 'bank' | 'credit_card' = 'bank', name?: string): Promise<string> {
  const { data, error } = await f.manager.db
    .from('bank_accounts')
    .insert({ firm_id: f.firmId, name: name ?? `Acct ${crypto.randomUUID().slice(0, 8)}`, kind })
    .select('id')
    .single()
  if (error || !data) throw new Error(`account insert failed: ${error?.message}`)
  return data.id as string
}

export function payload(lines: LineInput[]) {
  return lines.map((l) => ({
    posted_on: l.posted_on,
    amount: l.amount,
    description: l.description,
    clean_description: l.description.toUpperCase(),
    bank_ref: l.bank_ref ?? null,
    dedupe_key: l.bank_ref
      ? `fitid:${l.bank_ref}`
      : `h:${createHash('sha256').update(`${l.posted_on}|${l.amount}|${l.description}`).digest('hex')}`,
  }))
}

export async function importLines(f: Firm, accountId: string, lines: LineInput[]) {
  const { data, error } = await f.manager.db.rpc('import_bank_lines', {
    p_account: accountId,
    p_file_name: 'test.ofx',
    p_format: 'ofx',
    p_lines: payload(lines),
  })
  if (error) throw new Error(`import failed: ${error.message}`)
  return (data as { import_id: string; inserted: number; duplicates: number }[])[0]
}

/** Imports one line and returns its id. */
export async function oneLine(f: Firm, accountId: string, line: LineInput): Promise<string> {
  const ref = line.bank_ref ?? crypto.randomUUID()
  await importLines(f, accountId, [{ ...line, bank_ref: ref }])
  const { data, error } = await f.manager.db
    .from('bank_lines')
    .select('id')
    .eq('account_id', accountId)
    .eq('dedupe_key', `fitid:${ref}`)
    .single()
  if (error || !data) throw new Error(`line lookup failed: ${error?.message}`)
  return data.id as string
}
