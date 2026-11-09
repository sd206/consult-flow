type DbError = { code?: string; message?: string; details?: string }

const GENERIC = 'Something went wrong. Please try again.'
const NAME_IN_USE = 'That name is already in use.'
const DATES = 'The end date must be on or after the start date.'

const BY_MATCH: [string, string][] = [
  ['firm_members_firm_user_key', 'That person is already a member of this firm.'],
  ['LAST_ADMIN', 'A firm needs at least one Admin.'],
  ['consultants_vendor_required_chk', 'Vendor contractors must be linked to a vendor, and other types must not be.'],
  ['consultants_vendor_fk', 'This vendor still has consultants. Reassign or remove them first.'],
  ['consultants_firm_email_key', 'A consultant with that email already exists.'],
  ['consultant_cost_rates_consultant_from_key', 'A cost rate already starts on that date.'],
  ['vendors_firm_name_key', NAME_IN_USE],
  ['clients_firm_name_key', NAME_IN_USE],
  ['projects_firm_code_key', 'That project code is already in use.'],
  ['projects_client_fk', 'This client still has projects.'],
  ['project_assignments_no_overlap', 'This consultant already has a rate for this project in that date range.'],
  ['project_assignments_dates_chk', DATES],
  ['projects_dates_chk', DATES],
]

export function mapDbError(err: DbError | null): string {
  if (!err) return GENERIC
  console.error(err)
  const text = `${err.message ?? ''} ${err.details ?? ''}`
  for (const [needle, message] of BY_MATCH) {
    if (text.includes(needle)) return message
  }
  if (err.code === '42501' || text.includes('row-level security')) {
    return "You don't have permission to do that."
  }
  return GENERIC
}
