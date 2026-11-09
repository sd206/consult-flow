-- Fixes from the Phase 2 final review: SQL-side hour totals, a per-timesheet
-- DAY_OVER_24 check, project names for a timesheet's entries, a note length
-- limit, decision fields cleared on resubmit, and an approve-time guard
-- against null rate snapshots.

-- ---------------------------------------------------------------------------
-- Note length (the form enforces the same limit).
-- ---------------------------------------------------------------------------
alter table public.time_entries
  add constraint time_entries_note_len_chk check (note is null or char_length(note) <= 500);

-- ---------------------------------------------------------------------------
-- Entry validation: the day total only needs this timesheet's entries.
-- ---------------------------------------------------------------------------
create or replace function public.time_entries_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ts public.timesheets%rowtype;
  v_day_total numeric;
begin
  select * into v_ts from public.timesheets t
  where t.firm_id = new.firm_id and t.id = new.timesheet_id;
  if not found then
    return new; -- time_entries_timesheet_fk rejects the row
  end if;

  if v_ts.status not in ('draft', 'rejected') then
    raise exception 'TIMESHEET_LOCKED' using errcode = 'P0001';
  end if;

  if new.work_date < v_ts.week_start or new.work_date > v_ts.week_start + 6 then
    raise exception 'ENTRY_OUTSIDE_WEEK' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.project_assignments a
    where a.firm_id = new.firm_id
      and a.project_id = new.project_id
      and a.consultant_id = v_ts.consultant_id
      and a.effective_from <= new.work_date
      and (a.effective_to is null or a.effective_to >= new.work_date)
  ) then
    raise exception 'NO_ASSIGNMENT' using errcode = 'P0001';
  end if;

  -- Out-of-range hours are left to time_entries_hours_chk so the user sees
  -- the per-entry message rather than DAY_OVER_24.
  if new.hours is null or new.hours <= 0 or new.hours > 24 then
    return new;
  end if;

  -- One timesheet per consultant-week plus ENTRY_OUTSIDE_WEEK guarantee every
  -- entry for this consultant on this day is in this timesheet.
  select coalesce(sum(e.hours), 0) into v_day_total
  from public.time_entries e
  where e.timesheet_id = new.timesheet_id
    and e.work_date = new.work_date
    and e.id <> new.id;

  if v_day_total + new.hours > 24 then
    raise exception 'DAY_OVER_24' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute on function public.time_entries_validate() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Total hours per timesheet, summed in SQL (admin/manager only). Every
-- requested timesheet of p_firm gets a row; no entries -> '0.00'.
-- ---------------------------------------------------------------------------
create function public.timesheet_totals(p_firm uuid, p_ids uuid[])
returns table (timesheet_id uuid, total_hours text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role(p_firm, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  return query
  select t.id, coalesce(sum(e.hours), 0)::numeric(12, 2)::text
  from public.timesheets t
  left join public.time_entries e on e.firm_id = t.firm_id and e.timesheet_id = t.id
  where t.firm_id = p_firm and t.id = any (p_ids)
  group by t.id;
end;
$$;

revoke execute on function public.timesheet_totals(uuid, uuid[]) from public, anon;
grant execute on function public.timesheet_totals(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Projects that have entries in a timesheet (names only, never rates), so a
-- consultant sees real names for projects whose assignment no longer covers
-- the week. Same permission rule as timesheet_entries.
-- ---------------------------------------------------------------------------
create function public.timesheet_projects(p_timesheet uuid)
returns table (project_id uuid, project_name text, project_code text, client_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_firm uuid;
  v_consultant uuid;
begin
  select t.firm_id, t.consultant_id into v_firm, v_consultant
  from public.timesheets t where t.id = p_timesheet;
  if not found then
    raise exception 'TIMESHEET_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.can_edit_consultant_time(v_firm, v_consultant) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  return query
  select p.id, p.name, p.code, cl.name
  from public.projects p
  join public.clients cl on cl.firm_id = p.firm_id and cl.id = p.client_id
  where p.firm_id = v_firm
    and exists (
      select 1 from public.time_entries e
      where e.firm_id = v_firm and e.timesheet_id = p_timesheet and e.project_id = p.id
    )
  order by cl.name, p.name;
end;
$$;

revoke execute on function public.timesheet_projects(uuid) from public, anon;
grant execute on function public.timesheet_projects(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Submit clears the previous decision (the audit log keeps the history).
-- ---------------------------------------------------------------------------
create or replace function public.submit_timesheet(p_timesheet uuid)
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
  set status = 'submitted', submitted_at = now(),
      decided_by = null, decided_at = null, decision_comment = null
  where id = v_ts.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approve: the pre-checks give the clear error in the common case; the
-- post-update checks catch an assignment or cost rate that changed between
-- the pre-checks and the snapshot UPDATE (the raise rolls back the call).
-- ---------------------------------------------------------------------------
create or replace function public.approve_timesheet(p_timesheet uuid)
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

  if exists (
    select 1 from public.time_entries e
    where e.firm_id = v_ts.firm_id
      and e.timesheet_id = v_ts.id
      and e.client_rate_snapshot is null
  ) then
    raise exception 'NO_ASSIGNMENT' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.time_entries e
    where e.firm_id = v_ts.firm_id
      and e.timesheet_id = v_ts.id
      and e.cost_rate_snapshot is null
  ) then
    raise exception 'COST_RATE_MISSING' using errcode = 'P0001';
  end if;

  update public.timesheets
  set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_comment = null
  where id = v_ts.id;
end;
$$;
