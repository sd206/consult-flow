// Local demo data: run after `npm run db:reset` with the local Supabase stack up.
//   node scripts/seed-demo.mjs
// Creates "Demo Consulting" with sample people, hours, invoices, payments and expenses.
// Local only — never point this at a hosted project.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { seedDemoBank } from './seed-demo-bank.mjs'

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
const PASSWORD = 'demo-password-123'

function must(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res.data
}

async function signIn(email, password) {
  const db = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts)
  must(await db.auth.signInWithPassword({ email, password }), `sign in ${email}`)
  return db
}

async function newUser(email, displayName) {
  const u = must(
    await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { password_set: true } }),
    `create user ${email}`,
  ).user
  must(await admin.from('profiles').update({ display_name: displayName }).eq('user_id', u.id), 'profile name')
  return u.id
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------- firm and people
const ownerId = must(await admin.from('profiles').select('user_id').eq('email', 'owner@local.test').single(), 'owner').user_id
const mayaId = await newUser('maya@demo.test', 'Maya Patel')
const danaUserId = await newUser('dana@demo.test', 'Dana Brooks')

const firm = must(
  await admin
    .from('firms')
    .insert({
      name: 'Demo Consulting',
      address: '12 High Street\nAustin, TX 78701',
      contact_name: 'Accounts',
      contact_email: 'billing@demo-consulting.test',
      contact_phone: '+1 512 555 0100',
      currency: 'USD',
      default_tax_percent: 8.25,
      invoice_number_pattern: 'DEMO-{YYYY}-{SEQ:4}',
      default_payment_terms_days: 30,
    })
    .select('id')
    .single(),
  'firm',
)
const firmId = firm.id
must(
  await admin.from('firm_members').insert([
    { firm_id: firmId, user_id: ownerId, role: 'admin' },
    { firm_id: firmId, user_id: mayaId, role: 'manager' },
    { firm_id: firmId, user_id: danaUserId, role: 'consultant' },
  ]),
  'members',
)

const maya = await signIn('maya@demo.test', PASSWORD)

const vendor = must(
  await maya.from('vendors').insert({ firm_id: firmId, name: 'Northwind Talent', contact_name: 'Sam Reyes', email: 'sam@northwind.test' }).select('id').single(),
  'vendor',
)
const dana = must(
  await maya.from('consultants').insert({ firm_id: firmId, name: 'Dana Brooks', email: 'dana@demo.test', type: 'employee', user_id: danaUserId }).select('id').single(),
  'Dana',
)
const lee = must(
  await maya.from('consultants').insert({ firm_id: firmId, name: 'Lee Chen', email: 'lee@northwind.test', type: 'vendor', vendor_id: vendor.id }).select('id').single(),
  'Lee',
)
must(
  await maya.from('consultant_cost_rates').insert([
    { firm_id: firmId, consultant_id: dana.id, hourly_cost: 85, effective_from: '2026-01-01' },
    { firm_id: firmId, consultant_id: lee.id, hourly_cost: 110, effective_from: '2026-01-01' },
  ]),
  'cost rates',
)

// ---------------------------------------------------------------- clients and projects
const [globex, initech] = must(
  await maya
    .from('clients')
    .insert([
      { firm_id: firmId, name: 'Globex Corporation', billing_contact_name: 'Accounts Payable', billing_email: 'ap@globex.test', billing_address: '500 Market St\nSan Francisco, CA 94105' },
      { firm_id: firmId, name: 'Initech', billing_contact_name: 'Bill Lumbergh', billing_email: 'finance@initech.test', billing_address: '4120 Freidrich Ln\nAustin, TX 78744' },
    ])
    .select('id, name')
    .order('name'),
  'clients',
)
const [portal, audit] = must(
  await maya
    .from('projects')
    .insert([
      { firm_id: firmId, client_id: globex.id, name: 'Customer Portal', code: 'GLX-PORTAL', start_date: '2026-08-01' },
      { firm_id: firmId, client_id: initech.id, name: 'Security Audit', code: 'INI-AUDIT', start_date: '2026-08-01' },
    ])
    .select('id, name')
    .order('name'),
  'projects',
)
must(
  await maya.from('project_assignments').insert([
    { firm_id: firmId, project_id: portal.id, consultant_id: dana.id, client_rate: 150, effective_from: '2026-08-01' },
    { firm_id: firmId, project_id: audit.id, consultant_id: dana.id, client_rate: 160, effective_from: '2026-08-01' },
    { firm_id: firmId, project_id: audit.id, consultant_id: lee.id, client_rate: 180, effective_from: '2026-08-01' },
  ]),
  'assignments',
)

// ---------------------------------------------------------------- timesheets
const notes = ['Requirements workshop', 'API design', 'Build sprint', 'Testing and fixes', 'Stakeholder review']
function danaWeek(monday, partial = false) {
  const days = partial ? [0, 1] : [0, 1, 2, 3]
  const e = days.map((d) => ({ projectId: portal.id, workDate: addDays(monday, d), hours: '7', note: notes[d % notes.length] }))
  if (!partial) e.push({ projectId: audit.id, workDate: addDays(monday, 4), hours: '6', note: 'Access review' })
  return e
}
const leeWeek = (monday) =>
  [0, 1, 2].map((d) => ({ projectId: audit.id, workDate: addDays(monday, d), hours: '8', note: d === 0 ? 'Firewall rules' : 'Pen-test follow-up' }))

async function week(consultantId, monday, entries, state) {
  const tsId = must(await maya.rpc('save_timesheet_week', { p_firm: firmId, p_consultant: consultantId, p_week_start: monday, p_entries: entries }), `save ${monday}`)
  if (state === 'draft') return
  must(await maya.rpc('submit_timesheet', { p_timesheet: tsId }), `submit ${monday}`)
  if (state === 'approved') must(await maya.rpc('approve_timesheet', { p_timesheet: tsId }), `approve ${monday}`)
}

for (let monday = '2026-09-07'; monday <= '2026-10-26'; monday = addDays(monday, 7)) {
  await week(dana.id, monday, danaWeek(monday), 'approved')
  await week(lee.id, monday, leeWeek(monday), 'approved')
}
await week(dana.id, '2026-11-02', danaWeek('2026-11-02'), 'submitted') // waiting for approval
await week(lee.id, '2026-11-02', leeWeek('2026-11-02'), 'submitted')
await week(dana.id, '2026-11-09', danaWeek('2026-11-09', true), 'draft') // this week, in progress

// ---------------------------------------------------------------- invoices and payments
const template = must(await maya.from('invoice_templates').select('id').eq('firm_id', firmId).eq('is_default', true).single(), 'template')

async function draft(clientId, start, end, { subject, issue, due, tax = 8.25 }) {
  const id = must(
    await maya.rpc('create_invoice_draft', { p_firm: firmId, p_client: clientId, p_start: start, p_end: end, p_template: template.id, p_consultants: null }),
    `draft ${subject}`,
  )
  must(await maya.rpc('update_invoice_draft', { p_invoice: id, p_subject: subject, p_issue_date: issue, p_due_date: due, p_tax_percent: tax, p_template: template.id }), `header ${subject}`)
  return id
}
async function issue(id) {
  must(await maya.rpc('issue_invoice', { p_invoice: id }), 'issue')
  return must(await maya.from('invoices').select('number, total::text').eq('id', id).single(), 'read invoice')
}
const pay = async (id, amount, paidOn, method, reference) =>
  must(await maya.rpc('record_payment', { p_invoice: id, p_amount: amount, p_paid_on: paidOn, p_method: method, p_reference: reference, p_notes: null }), `payment ${reference}`)

// Globex, September: issued and paid in full.
const inv1 = await draft(globex.id, '2026-09-01', '2026-09-30', { subject: 'Customer Portal — September', issue: '2026-10-02', due: '2026-11-01' })
const i1 = await issue(inv1)
await pay(inv1, i1.total, '2026-10-20', 'bank_transfer', 'GLX-REM-0920')

// Initech, September: issued, unpaid and overdue.
const inv2 = await draft(initech.id, '2026-09-01', '2026-09-30', { subject: 'Security Audit — September', issue: '2026-10-03', due: '2026-10-18' })
await issue(inv2)

// Globex, October: workshop fee, 5% loyalty discount, part-paid.
const inv3 = await draft(globex.id, '2026-10-01', '2026-10-31', { subject: 'Customer Portal — October', issue: '2026-11-03', due: '2026-12-03' })
must(await maya.rpc('save_manual_line', { p_invoice: inv3, p_line: null, p_description: 'Workshop facilitation (fixed fee)', p_quantity: 1, p_unit_price: 1200 }), 'fee')
must(await maya.rpc('set_invoice_discount', { p_invoice: inv3, p_type: 'percent', p_value: 5, p_label: 'Loyalty' }), 'discount')
await issue(inv3)
await pay(inv3, 2000, '2026-11-07', 'card', 'CARD-7781')

// Initech, October: left as a draft to edit.
await draft(initech.id, '2026-10-01', '2026-10-31', { subject: 'Security Audit — October', issue: '2026-11-10', due: '2026-12-10' })

// ---------------------------------------------------------------- expenses
const cats = Object.fromEntries(must(await maya.from('expense_categories').select('id, name').eq('firm_id', firmId), 'categories').map((c) => [c.name, c.id]))
must(
  await maya.from('expenses').insert([
    { firm_id: firmId, spent_on: '2026-09-10', category_id: cats.Travel, payee: 'Skyline Air', amount: 412.37, client_id: globex.id, project_id: portal.id, notes: 'Kickoff flights' },
    { firm_id: firmId, spent_on: '2026-09-15', category_id: cats.Software, payee: 'Figma', amount: 45 },
    { firm_id: firmId, spent_on: '2026-10-01', category_id: cats.Office, payee: 'WeWork', amount: 650, notes: 'October desk space' },
    { firm_id: firmId, spent_on: '2026-10-14', category_id: cats['Professional fees'], payee: 'Hall & Co Accountants', amount: 300 },
    { firm_id: firmId, spent_on: '2026-10-22', category_id: cats.Travel, payee: 'Metro Cabs', amount: 38.5, client_id: initech.id, project_id: audit.id },
    { firm_id: firmId, spent_on: '2026-11-04', category_id: cats.Software, payee: 'AWS', amount: 129.99, client_id: initech.id, notes: 'Audit tooling' },
  ]),
  'expenses',
)

// ---------------------------------------------------------------- bank statements
await seedDemoBank(maya, firmId)

console.log(`Demo Consulting ready (firm ${firmId}).`)
console.log(`Invoices issued: ${i1.number} (paid), plus an overdue one and a part-paid one; one draft.`)
console.log('Logins (password demo-password-123): maya@demo.test (Manager), dana@demo.test (Consultant). Owner: owner@local.test.')
