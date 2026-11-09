-- Timesheets and time entries. Writes happen only through security-definer
-- functions; consultants read their entries via timesheet_entries (no rates).

create type public.timesheet_status as enum ('draft', 'submitted', 'approved', 'rejected');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.timesheets (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  consultant_id uuid not null,
  week_start date not null,
  status public.timesheet_status not null default 'draft',
  submitted_at timestamptz,
  decided_by uuid references public.profiles (user_id) on delete set null,
  decided_at timestamptz,
  decision_comment text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint timesheets_firm_id_id_key unique (firm_id, id),
  constraint timesheets_consultant_fk foreign key (firm_id, consultant_id)
    references public.consultants (firm_id, id) on delete restrict,
  constraint timesheets_consultant_week_key unique (consultant_id, week_start),
  constraint timesheets_week_start_monday_chk check (extract(isodow from week_start) = 1)
);
create index timesheets_firm_status_week_idx on public.timesheets (firm_id, status, week_start);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  timesheet_id uuid not null,
  project_id uuid not null,
  work_date date not null,
  hours numeric(5, 2) not null,
  note text,
  client_rate_snapshot numeric(12, 2),
  cost_rate_snapshot numeric(12, 2),
  invoice_line_id uuid, -- FK added in Phase 3
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint time_entries_timesheet_fk foreign key (firm_id, timesheet_id)
    references public.timesheets (firm_id, id) on delete cascade,
  constraint time_entries_project_fk foreign key (firm_id, project_id)
    references public.projects (firm_id, id) on delete restrict,
  constraint time_entries_hours_chk check (hours > 0 and hours <= 24),
  constraint time_entries_cell_key unique (timesheet_id, project_id, work_date)
);
create index time_entries_firm_project_date_idx
  on public.time_entries (firm_id, project_id, work_date);

create trigger timesheets_set_updated_at before update on public.timesheets
  for each row execute function public.set_updated_at();
create trigger time_entries_set_updated_at before update on public.time_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges and RLS: read-only to authenticated; no direct writes.
-- ---------------------------------------------------------------------------
alter table public.timesheets enable row level security;
alter table public.time_entries enable row level security;

revoke all on public.timesheets, public.time_entries from anon, authenticated;
grant select on public.timesheets, public.time_entries to authenticated;

create policy timesheets_select on public.timesheets
  for select to authenticated
  using (
    public.has_role(firm_id, '{admin,manager}')
    or exists (
      select 1 from public.consultants c
      where c.firm_id = timesheets.firm_id
        and c.id = timesheets.consultant_id
        and c.user_id = auth.uid()
    )
    and public.is_member(firm_id)
  );

-- Consultants read their entries through timesheet_entries(), which hides rates.
create policy time_entries_select on public.time_entries
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));

-- ---------------------------------------------------------------------------
-- Who may enter time for a consultant: admins/managers of the firm, or the
-- consultant's own linked login (still a member). False if the consultant
-- isn't in p_firm.
-- ---------------------------------------------------------------------------
create function public.can_edit_consultant_time(p_firm uuid, p_consultant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.consultants c
    where c.firm_id = p_firm
      and c.id = p_consultant
      and (
        public.has_role(p_firm, '{admin,manager}'::public.firm_role[])
        or (c.user_id = auth.uid() and public.is_member(p_firm))
      )
  )
$$;

revoke execute on function public.can_edit_consultant_time(uuid, uuid) from public, anon;
grant execute on function public.can_edit_consultant_time(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Entry validation (runs for every insert/update of entry content).
-- ---------------------------------------------------------------------------
create function public.time_entries_validate()
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

  select coalesce(sum(e.hours), 0) into v_day_total
  from public.time_entries e
  join public.timesheets t on t.firm_id = e.firm_id and t.id = e.timesheet_id
  where e.firm_id = new.firm_id
    and t.consultant_id = v_ts.consultant_id
    and e.work_date = new.work_date
    and e.id <> new.id;

  if v_day_total + new.hours > 24 then
    raise exception 'DAY_OVER_24' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute on function public.time_entries_validate() from public, anon, authenticated;

create trigger time_entries_validate
  before insert or update of project_id, work_date, hours, note on public.time_entries
  for each row execute function public.time_entries_validate();

-- ---------------------------------------------------------------------------
-- Save a whole week: replaces all entries of the consultant's timesheet.
-- p_entries: [{ "projectId": uuid, "workDate": "YYYY-MM-DD", "hours": "7.50", "note": string|null }]
-- ---------------------------------------------------------------------------
create function public.save_timesheet_week(
  p_firm uuid,
  p_consultant uuid,
  p_week_start date,
  p_entries jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status public.timesheet_status;
begin
  if not exists (
    select 1 from public.consultants c where c.firm_id = p_firm and c.id = p_consultant
  ) then
    raise exception 'CONSULTANT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.can_edit_consultant_time(p_firm, p_consultant) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if p_week_start > date_trunc('week', current_date)::date then
    raise exception 'FUTURE_WEEK' using errcode = 'P0001';
  end if;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'entries must be a JSON array' using errcode = '22023';
  end if;

  insert into public.timesheets (firm_id, consultant_id, week_start)
  values (p_firm, p_consultant, p_week_start)
  on conflict (consultant_id, week_start) do nothing;

  select t.id, t.status into v_id, v_status
  from public.timesheets t
  where t.firm_id = p_firm and t.consultant_id = p_consultant and t.week_start = p_week_start
  for update;

  if v_status not in ('draft', 'rejected') then
    raise exception 'TIMESHEET_LOCKED' using errcode = 'P0001';
  end if;

  delete from public.time_entries e where e.firm_id = p_firm and e.timesheet_id = v_id;

  -- Row-level BEFORE triggers see rows inserted earlier in this statement,
  -- so DAY_OVER_24 accounts for the whole new week.
  insert into public.time_entries (firm_id, timesheet_id, project_id, work_date, hours, note)
  select
    p_firm,
    v_id,
    (e ->> 'projectId')::uuid,
    (e ->> 'workDate')::date,
    (e ->> 'hours')::numeric(5, 2),
    e ->> 'note'
  from jsonb_array_elements(p_entries) e;

  return v_id;
end;
$$;

revoke execute on function public.save_timesheet_week(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.save_timesheet_week(uuid, uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Projects a consultant can book in a week: names and dates only, never rates.
-- ---------------------------------------------------------------------------
create function public.week_projects(p_firm uuid, p_consultant uuid, p_week_start date)
returns table (
  assignment_id uuid,
  project_id uuid,
  project_name text,
  project_code text,
  client_name text,
  effective_from date,
  effective_to date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_edit_consultant_time(p_firm, p_consultant) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  return query
  select a.id, p.id, p.name, p.code, cl.name, a.effective_from, a.effective_to
  from public.project_assignments a
  join public.projects p on p.firm_id = a.firm_id and p.id = a.project_id
  join public.clients cl on cl.firm_id = p.firm_id and cl.id = p.client_id
  where a.firm_id = p_firm
    and a.consultant_id = p_consultant
    and a.effective_from <= p_week_start + 6
    and (a.effective_to is null or a.effective_to >= p_week_start)
  order by cl.name, p.name, a.effective_from;
end;
$$;

revoke execute on function public.week_projects(uuid, uuid, date) from public, anon;
grant execute on function public.week_projects(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Entries of one timesheet without rate snapshots; hours as text.
-- ---------------------------------------------------------------------------
create function public.timesheet_entries(p_timesheet uuid)
returns table (id uuid, project_id uuid, work_date date, hours text, note text)
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
  select e.id, e.project_id, e.work_date, e.hours::text, e.note
  from public.time_entries e
  where e.firm_id = v_firm and e.timesheet_id = p_timesheet
  order by e.work_date, e.project_id;
end;
$$;

revoke execute on function public.timesheet_entries(uuid) from public, anon;
grant execute on function public.timesheet_entries(uuid) to authenticated;
