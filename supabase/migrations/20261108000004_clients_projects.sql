-- Clients, projects, dated client-rate assignments.

create extension if not exists btree_gist with schema extensions;

create type public.project_status as enum ('active', 'on_hold', 'closed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  name text not null check (length(btrim(name)) > 0),
  billing_contact_name text,
  billing_email text,
  billing_phone text,
  billing_address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint clients_firm_id_id_key unique (firm_id, id)
);
create unique index clients_firm_name_key on public.clients (firm_id, lower(name));

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  client_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  code text check (code is null or length(btrim(code)) > 0),
  status public.project_status not null default 'active',
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint projects_firm_id_id_key unique (firm_id, id),
  constraint projects_client_fk foreign key (firm_id, client_id)
    references public.clients (firm_id, id) on delete restrict,
  constraint projects_dates_chk
    check (end_date is null or start_date is null or end_date >= start_date)
);
create unique index projects_firm_code_key on public.projects (firm_id, lower(code))
  where code is not null;
create index projects_client_idx on public.projects (firm_id, client_id);

create table public.project_assignments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  project_id uuid not null,
  consultant_id uuid not null,
  client_rate numeric(12, 2) not null check (client_rate >= 0),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint project_assignments_project_fk foreign key (firm_id, project_id)
    references public.projects (firm_id, id) on delete restrict,
  constraint project_assignments_consultant_fk foreign key (firm_id, consultant_id)
    references public.consultants (firm_id, id) on delete restrict,
  constraint project_assignments_dates_chk
    check (effective_to is null or effective_to >= effective_from),
  constraint project_assignments_no_overlap exclude using gist (
    project_id with =,
    consultant_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);
create index project_assignments_project_idx on public.project_assignments (firm_id, project_id);
create index project_assignments_consultant_idx
  on public.project_assignments (firm_id, consultant_id);

create trigger clients_set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create trigger project_assignments_set_updated_at before update on public.project_assignments
  for each row execute function public.set_updated_at();

create trigger project_assignments_audit
  after insert or update or delete on public.project_assignments
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Privileges and RLS (admin/manager only; consultants use my_assignments)
-- ---------------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.project_assignments enable row level security;

revoke all on public.clients, public.projects, public.project_assignments
  from anon, authenticated;
grant select, insert, update, delete
  on public.clients, public.projects, public.project_assignments to authenticated;

create policy clients_select on public.clients
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
create policy clients_insert on public.clients
  for insert to authenticated with check (public.has_role(firm_id, '{admin,manager}'));
create policy clients_update on public.clients
  for update to authenticated
  using (public.has_role(firm_id, '{admin,manager}'))
  with check (public.has_role(firm_id, '{admin,manager}'));
create policy clients_delete on public.clients
  for delete to authenticated using (public.has_role(firm_id, '{admin,manager}'));

create policy projects_select on public.projects
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
create policy projects_insert on public.projects
  for insert to authenticated with check (public.has_role(firm_id, '{admin,manager}'));
create policy projects_update on public.projects
  for update to authenticated
  using (public.has_role(firm_id, '{admin,manager}'))
  with check (public.has_role(firm_id, '{admin,manager}'));
create policy projects_delete on public.projects
  for delete to authenticated using (public.has_role(firm_id, '{admin,manager}'));

create policy project_assignments_select on public.project_assignments
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
create policy project_assignments_insert on public.project_assignments
  for insert to authenticated with check (public.has_role(firm_id, '{admin,manager}'));
create policy project_assignments_update on public.project_assignments
  for update to authenticated
  using (public.has_role(firm_id, '{admin,manager}'))
  with check (public.has_role(firm_id, '{admin,manager}'));
create policy project_assignments_delete on public.project_assignments
  for delete to authenticated using (public.has_role(firm_id, '{admin,manager}'));

-- ---------------------------------------------------------------------------
-- Consultant-facing view of own assignments: names and dates only, never rates.
-- ---------------------------------------------------------------------------
create function public.my_assignments(p_firm uuid)
returns table (
  assignment_id uuid,
  project_id uuid,
  project_name text,
  project_code text,
  client_name text,
  effective_from date,
  effective_to date
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, p.id, p.name, p.code, cl.name, a.effective_from, a.effective_to
  from public.project_assignments a
  join public.consultants c on c.firm_id = a.firm_id and c.id = a.consultant_id
  join public.projects p on p.firm_id = a.firm_id and p.id = a.project_id
  join public.clients cl on cl.firm_id = p.firm_id and cl.id = p.client_id
  where public.is_member(p_firm)
    and a.firm_id = p_firm
    and c.firm_id = p_firm
    and c.user_id = auth.uid()
  order by a.effective_from desc, p.name
$$;

revoke execute on function public.my_assignments(uuid) from public, anon;
grant execute on function public.my_assignments(uuid) to authenticated, service_role;
