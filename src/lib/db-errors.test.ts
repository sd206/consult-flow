import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mapDbError } from './db-errors'

const GENERIC = 'Something went wrong. Please try again.'
const unique = (name: string) => ({
  code: '23505',
  message: `duplicate key value violates unique constraint "${name}"`,
  details: 'Key exists.',
})
const check = (name: string) => ({
  code: '23514',
  message: `new row violates check constraint "${name}"`,
})
const fk = (name: string) => ({
  code: '23503',
  message: `update or delete on table violates foreign key constraint "${name}"`,
})

describe('mapDbError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const cases: [string, Parameters<typeof mapDbError>[0], string][] = [
    ['firm_members_firm_user_key', unique('firm_members_firm_user_key'), 'That person is already a member of this firm.'],
    ['LAST_ADMIN', { code: 'P0001', message: 'LAST_ADMIN' }, 'A firm needs at least one Admin.'],
    ['consultants_vendor_required_chk', check('consultants_vendor_required_chk'), 'Vendor contractors must be linked to a vendor, and other types must not be.'],
    ['consultants_vendor_fk', fk('consultants_vendor_fk'), 'This vendor still has consultants. Reassign or remove them first.'],
    ['consultants_firm_email_key', unique('consultants_firm_email_key'), 'A consultant with that email already exists.'],
    ['consultant_cost_rates_consultant_from_key', unique('consultant_cost_rates_consultant_from_key'), 'A cost rate already starts on that date.'],
    ['vendors_firm_name_key', unique('vendors_firm_name_key'), 'That name is already in use.'],
    ['clients_firm_name_key', unique('clients_firm_name_key'), 'That name is already in use.'],
    ['projects_firm_code_key', unique('projects_firm_code_key'), 'That project code is already in use.'],
    ['projects_client_fk', fk('projects_client_fk'), 'This client still has projects.'],
    ['project_assignments_no_overlap', { code: '23P01', message: 'conflicting key value violates exclusion constraint "project_assignments_no_overlap"' }, 'This consultant already has a rate for this project in that date range.'],
    ['project_assignments_dates_chk', check('project_assignments_dates_chk'), 'The end date must be on or after the start date.'],
    ['projects_dates_chk', check('projects_dates_chk'), 'The end date must be on or after the start date.'],
    ['RATE_DATE_INVALID', { code: 'P0001', message: 'RATE_DATE_INVALID' }, "The new rate must start after the current rate's start date."],
    ['ASSIGNMENT_NOT_FOUND', { code: 'P0001', message: 'ASSIGNMENT_NOT_FOUND' }, 'Assignment not found.'],
    ['42501', { code: '42501', message: 'permission denied' }, "You don't have permission to do that."],
    ['RLS violation', { code: '42501', message: 'new row violates row-level security policy for table "x"' }, "You don't have permission to do that."],
    ['constraint in details', { code: '23505', message: 'duplicate key', details: 'constraint "projects_firm_code_key"' }, 'That project code is already in use.'],
    ['unknown', { code: '99999', message: 'boom' }, GENERIC],
    ['null', null, GENERIC],
  ]

  it.each(cases)('%s', (_name, err, expected) => {
    expect(mapDbError(err)).toBe(expected)
  })

  const timesheetCases: [string, string][] = [
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
    ['COST_RATE_MISSING', 'This consultant has no cost rate for a day worked. Add a cost rate starting on or before that day, then approve.'],
    ['REJECT_COMMENT_REQUIRED', 'Add a comment saying what needs to change.'],
    ['CONSULTANT_NOT_FOUND', 'Consultant not found.'],
  ]

  it.each(timesheetCases)('timesheet error %s', (needle, expected) => {
    expect(mapDbError({ code: 'P0001', message: `x ${needle} y` })).toBe(expected)
  })

  it('logs the raw error', () => {
    const err = { code: '99999', message: 'boom' }
    mapDbError(err)
    expect(console.error).toHaveBeenCalledWith(err)
  })
})
