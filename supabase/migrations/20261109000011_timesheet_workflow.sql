-- Timesheet workflow: submit, approve (freezing client and cost rates onto
-- each entry), reject, reopen. Each function locks the timesheet row first,
-- then checks permission, then the state transition.
--
-- Ruling: project status (on_hold/closed) does not block time entry or
-- approval; the assignment dates alone decide.
--
-- Snapshot updates below touch only client_rate_snapshot/cost_rate_snapshot,
-- so the time_entries_validate trigger (content columns only) does not fire.

-- ---------------------------------------------------------------------------
-- draft | rejected -> submitted (consultant, or a manager on their behalf)
-- ---------------------------------------------------------------------------
create function public.submit_timesheet(p_timesheet uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ts public.timesheets%rowtype;
begin
  select * into v_ts from public.timesheets t where t.id = p_timesheet for update;
  if not found then
    raise exception 'TIMESHEET_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.can_edit_consultant_time(v_ts.firm_id, v_ts.consultant_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_ts.status not in ('draft', 'rejected') then
    raise exception 'TIMESHEET_STATE' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.time_entries e
    where e.firm_id = v_ts.firm_id and e.timesheet_id = v_ts.id
  ) then
    raise exception 'TIMESHEET_EMPTY' using errcode = 'P0001';
  end if;

  update public.timesheets
  set status = 'submitted', submitted_at = now()
  where id = v_ts.id;
end;
$$;

revoke execute on function public.submit_timesheet(uuid) from public, anon;
grant execute on function public.submit_timesheet(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- submitted -> approved (admin/manager, including their own timesheet).
-- All-or-nothing: if any entry lacks an assignment or cost rate on its
-- work_date, raise before anything is written.
-- ---------------------------------------------------------------------------
create function public.approve_timesheet(p_timesheet uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ts public.timesheets%rowtype;
begin
  select * into v_ts from public.timesheets t where t.id = p_timesheet for update;
  if not found then
    raise exception 'TIMESHEET_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.has_role(v_ts.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_ts.status <> 'submitted' then
    raise exception 'TIMESHEET_STATE' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.time_entries e
    where e.firm_id = v_ts.firm_id
      and e.timesheet_id = v_ts.id
      and not exists (
        select 1 from public.project_assignments a
        where a.firm_id = e.firm_id
          and a.project_id = e.project_id
          and a.consultant_id = v_ts.consultant_id
          and a.effective_from <= e.work_date
          and (a.effective_to is null or a.effective_to >= e.work_date)
      )
  ) then
    raise exception 'NO_ASSIGNMENT' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.time_entries e
    where e.firm_id = v_ts.firm_id
      and e.timesheet_id = v_ts.id
      and not exists (
        select 1 from public.consultant_cost_rates r
        where r.firm_id = e.firm_id
          and r.consultant_id = v_ts.consultant_id
          and r.effective_from <= e.work_date
      )
  ) then
    raise exception 'COST_RATE_MISSING' using errcode = 'P0001';
  end if;

  -- project_assignments_no_overlap guarantees at most one assignment per
  -- (project, consultant, day), so the client-rate subquery is single-row.
  update public.time_entries e
  set
    client_rate_snapshot = (
      select a.client_rate from public.project_assignments a
      where a.firm_id = e.firm_id
        and a.project_id = e.project_id
        and a.consultant_id = v_ts.consultant_id
        and a.effective_from <= e.work_date
        and (a.effective_to is null or a.effective_to >= e.work_date)
    ),
    cost_rate_snapshot = (
      select r.hourly_cost from public.consultant_cost_rates r
      where r.firm_id = e.firm_id
        and r.consultant_id = v_ts.consultant_id
        and r.effective_from <= e.work_date
      order by r.effective_from desc
      limit 1
    )
  where e.firm_id = v_ts.firm_id and e.timesheet_id = v_ts.id;

  update public.timesheets
  set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_comment = null
  where id = v_ts.id;
end;
$$;

revoke execute on function public.approve_timesheet(uuid) from public, anon;
grant execute on function public.approve_timesheet(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- submitted -> rejected (admin/manager), with a required comment.
-- ---------------------------------------------------------------------------
create function public.reject_timesheet(p_timesheet uuid, p_comment text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ts public.timesheets%rowtype;
  v_comment text := btrim(coalesce(p_comment, ''));
begin
  select * into v_ts from public.timesheets t where t.id = p_timesheet for update;
  if not found then
    raise exception 'TIMESHEET_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.has_role(v_ts.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_ts.status <> 'submitted' then
    raise exception 'TIMESHEET_STATE' using errcode = 'P0001';
  end if;

  if v_comment = '' then
    raise exception 'REJECT_COMMENT_REQUIRED' using errcode = 'P0001';
  end if;

  update public.timesheets
  set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_comment = v_comment
  where id = v_ts.id;
end;
$$;

revoke execute on function public.reject_timesheet(uuid, text) from public, anon;
grant execute on function public.reject_timesheet(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- approved -> draft (admin/manager), unless any hours are invoiced. Clears
-- the rate snapshots and the submission/decision fields.
-- ---------------------------------------------------------------------------
create function public.reopen_timesheet(p_timesheet uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ts public.timesheets%rowtype;
begin
  select * into v_ts from public.timesheets t where t.id = p_timesheet for update;
  if not found then
    raise exception 'TIMESHEET_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.has_role(v_ts.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_ts.status <> 'approved' then
    raise exception 'TIMESHEET_STATE' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.time_entries e
    where e.firm_id = v_ts.firm_id
      and e.timesheet_id = v_ts.id
      and e.invoice_line_id is not null
  ) then
    raise exception 'TIMESHEET_INVOICED' using errcode = 'P0001';
  end if;

  update public.time_entries e
  set client_rate_snapshot = null, cost_rate_snapshot = null
  where e.firm_id = v_ts.firm_id and e.timesheet_id = v_ts.id;

  update public.timesheets
  set status = 'draft', submitted_at = null, decided_by = null, decided_at = null,
      decision_comment = null
  where id = v_ts.id;
end;
$$;

revoke execute on function public.reopen_timesheet(uuid) from public, anon;
grant execute on function public.reopen_timesheet(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit every timesheet change (status transitions included).
-- ---------------------------------------------------------------------------
create trigger timesheets_audit
  after insert or update or delete on public.timesheets
  for each row execute function public.audit_row();
