// Demo bank accounts and statement lines for "Demo Consulting".
// Called at the end of seed-demo.mjs; can also run on its own against an
// already-seeded local database:  node scripts/seed-demo-bank.mjs
// Local only — never point this at a hosted project.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

function must(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res.data
}

const clean = (s) => s.toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 80)
const line = (posted_on, amount, description, ref) => ({
  posted_on,
  amount,
  description,
  clean_description: clean(description),
  bank_ref: ref,
  dedupe_key: `fitid:${ref}`,
})

/** `maya` is a signed-in manager client for the firm. */
export async function seedDemoBank(maya, firmId) {
  const account = async (name, kind, last4) =>
    must(await maya.from('bank_accounts').insert({ firm_id: firmId, name, kind, last4 }).select('id').single(), `account ${name}`).id
  const importLines = async (accountId, file, lines) =>
    must(await maya.rpc('import_bank_lines', { p_account: accountId, p_file_name: file, p_format: 'ofx', p_lines: lines }), `import ${file}`)

  const checking = await account('Main checking', 'bank', '4821')
  const amex = await account('Amex Business', 'credit_card', '1009')

  // An open invoice's balance, so the deposit matches it exactly.
  const open = must(
    await maya
      .from('invoices')
      .select('number, total::text, amount_paid::text, clients(name)')
      .eq('firm_id', firmId)
      .eq('status', 'issued')
      .order('number')
      .limit(1)
      .single(),
    'open invoice',
  )
  const balance = (Number(open.total) - Number(open.amount_paid)).toFixed(2)
  const client = open.clients.name.toUpperCase()

  // October statement: WeWork rent, already entered by hand; matched below so the category is remembered.
  await importLines(checking, 'checking-2026-10.qfx', [line('2026-10-01', '-650.00', 'WEWORK', 'CHK-1001')])
  const weworkLine = must(await maya.from('bank_lines').select('id').eq('account_id', checking).eq('bank_ref', 'CHK-1001').single(), 'wework line').id
  const weworkExpense = must(await maya.from('expenses').select('id').eq('firm_id', firmId).eq('payee', 'WeWork').single(), 'wework expense').id
  must(await maya.rpc('link_bank_line', { p_line: weworkLine, p_payment: null, p_expense: weworkExpense }), 'link wework')

  // November statement: lines to review.
  await importLines(checking, 'checking-2026-11.qfx', [
    line('2026-11-01', '-650.00', 'WEWORK', 'CHK-1101'),
    line('2026-11-05', '-129.99', 'AWS EMEA', 'CHK-1102'),
    line('2026-11-06', balance, `ACH CREDIT ${client} REMITTANCE`, 'CHK-1103'),
    line('2026-11-09', '4.12', 'FIRST BANK INTEREST', 'CHK-1104'),
    line('2026-11-10', '-1000.00', 'ONLINE PAYMENT TO AMEX 1009', 'CHK-1105'),
  ])
  await importLines(amex, 'amex-2026-11.qfx', [
    line('2026-11-03', '-412.37', 'DELTA AIR LINES ATLANTA', 'AMX-2201'),
    line('2026-11-07', '-24.10', 'UBER *TRIP HELP.UBER.COM', 'AMX-2202'),
    line('2026-11-10', '1000.00', 'PAYMENT RECEIVED - THANK YOU', 'AMX-2203'),
  ])
  return { checking, amex, matchedInvoice: open.number }
}

// Standalone run against an existing demo firm.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = Object.fromEntries(
    readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  )
  const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_)) throw new Error(`Refusing to seed a non-local Supabase: ${URL_}`)
  const opts = { auth: { persistSession: false, autoRefreshToken: false } }
  const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, opts)
  const firm = must(await admin.from('firms').select('id').eq('name', 'Demo Consulting').single(), 'demo firm')
  const existing = must(await admin.from('bank_accounts').select('id').eq('firm_id', firm.id), 'accounts')
  if (existing.length > 0) {
    console.log('Demo bank accounts already exist; nothing to do.')
    process.exit(0)
  }
  const maya = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts)
  must(await maya.auth.signInWithPassword({ email: 'maya@demo.test', password: 'demo-password-123' }), 'sign in maya')
  const r = await seedDemoBank(maya, firm.id)
  console.log(`Demo bank data added: Main checking (6 lines, 1 matched) and Amex Business (3 lines). Deposit matches ${r.matchedInvoice}.`)
}
