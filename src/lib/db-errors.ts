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
  ['RATE_DATE_INVALID', "The new rate must start after the current rate's start date."],
  ['ASSIGNMENT_NOT_FOUND', 'Assignment not found.'],
  ['firms_invoice_pattern_seq_chk', 'Pattern must contain exactly one {SEQ:n}.'],
  ['firms_payment_terms_chk', 'Payment terms must be 0 to 365 days.'],
  ['firms_logo_path_chk', "That logo file doesn't belong to this firm."],
  ['consultants_firm_user_key', 'That user is already linked to another consultant.'],
  ['TIMESHEET_LOCKED', "This timesheet is submitted or approved and can't be edited."],
  ['TIMESHEET_STATE', "This timesheet can't be changed in its current state."],
  ['TIMESHEET_EMPTY', 'Add some hours before submitting.'],
  ['TIMESHEET_NOT_FOUND', 'Timesheet not found.'],
  ['TIMESHEET_INVOICED', "This timesheet has invoiced hours, so it can't be reopened."],
  ['FUTURE_WEEK', "You can't enter time for a future week."],
  ['timesheets_week_start_monday_chk', 'Weeks start on Monday.'],
  ['ENTRY_OUTSIDE_WEEK', "Each day must fall within the timesheet's week."],
  ['NO_ASSIGNMENT', "You're not assigned to that project on one of those days."],
  ['DAY_OVER_24', "A day can't have more than 24 hours in total."],
  ['time_entries_hours_chk', 'Enter hours between 0.01 and 24, up to 2 decimal places.'],
  ['time_entries_cell_key', 'That project already has hours on that day.'],
  ['time_entries_note_len_chk', 'Keep notes to 500 characters or fewer.'],
  ['COST_RATE_MISSING', 'This consultant has no cost rate for a day worked. Add a cost rate starting on or before that day, then approve.'],
  ['REJECT_COMMENT_REQUIRED', 'Add a comment saying what needs to change.'],
  ['CONSULTANT_NOT_FOUND', 'Consultant not found.'],
  ['INVOICE_NOT_FOUND', 'Invoice not found.'],
  ['INVOICE_STATE', "This invoice can't be changed in its current state."],
  ['INVOICE_EMPTY', 'Add at least one line before issuing.'],
  ['INVOICE_STALE', 'Hours changed since this draft was built. Regenerate the lines, then issue.'],
  ['INVOICE_HAS_PAYMENTS', "This invoice has payments, so it can't be voided."],
  ['LINE_NOT_MANUAL', 'Only manual lines can be changed this way.'],
  ['TEMPLATE_IS_DEFAULT', "The default template can't be deleted. Make another template the default first."],
  ['invoice_templates_firm_name_key', NAME_IN_USE],
  ['invoice_templates_accent_chk', 'Use a colour like #1F2937.'],
  ['invoices_template_fk', "This template is used by invoices, so it can't be deleted."],
  ['invoices_period_chk', 'The period end must be on or after the period start.'],
  ['invoices_due_chk', 'The due date must be on or after the issue date.'],
  ['invoices_tax_chk', 'Tax must be between 0 and 100 percent.'],
  ['invoice_lines_quantity_chk', 'Quantity must be more than 0.'],
  ['invoice_lines_description_chk', 'Enter a description.'],
  ['DISCOUNT_TOO_LARGE', "The discount can't be more than the subtotal."],
  ['invoices_discount_chk', "A percentage discount must be between 0 and 100, and an amount can't be negative."],
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
