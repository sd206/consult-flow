-- People: vendors, consultants, consultant cost rates.

create type public.consultant_type as enum ('employee', 'independent', 'vendor');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  name text not null check (length(btrim(name)) > 0),
  contact_name text,
  email text,
  phone text,
  address text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint vendors_firm_id_id_key unique (firm_id, id)
);
create unique index vendors_firm_name_key on public.vendors (firm_id, lower(name));

create table public.consultants (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  name text not null check (length(btrim(name)) > 0),
  email text not null check (length(btrim(email)) > 0),
  type public.consultant_type not null,
  vendor_id uuid,
  user_id uuid references public.profiles (user_id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint consultants_firm_id_id_key unique (firm_id, id),
  constraint consultants_vendor_required_chk check ((type = 'vendor') = (vendor_id is not null)),
  constraint consultants_vendor_fk foreign key (firm_id, vendor_id)
    references public.vendors (firm_id, id) on delete restrict
);
create unique index consultants_firm_email_key on public.consultants (firm_id, lower(email));
create index consultants_vendor_idx on public.consultants (firm_id, vendor_id);
create index consultants_user_id_idx on public.consultants (user_id);

create table public.consultant_cost_rates (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  consultant_id uuid not null,
  hourly_cost numeric(12, 2) not null check (hourly_cost >= 0),
  effective_from date not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint consultant_cost_rates_consultant_fk foreign key (firm_id, consultant_id)
    references public.consultants (firm_id, id) on delete cascade,
  constraint consultant_cost_rates_consultant_from_key unique (consultant_id, effective_from)
);

create trigger vendors_set_updated_at before update on public.vendors
  for each row execute function public.set_updated_at();
create trigger consultants_set_updated_at before update on public.consultants
  for each row execute function public.set_updated_at();
create trigger consultant_cost_rates_set_updated_at before update on public.consultant_cost_rates
  for each row execute function public.set_updated_at();

create trigger consultant_cost_rates_audit
  after insert or update or delete on public.consultant_cost_rates
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
alter table public.vendors enable row level security;
alter table public.consultants enable row level security;
alter table public.consultant_cost_rates enable row level security;

revoke all on public.vendors, public.consultants, public.consultant_cost_rates
  from anon, authenticated;
grant select, insert, update, delete
  on public.vendors, public.consultants, public.consultant_cost_rates to authenticated;

-- vendors: admin/manager only
create policy vendors_select on public.vendors
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
create policy vendors_insert on public.vendors
  for insert to authenticated with check (public.has_role(firm_id, '{admin,manager}'));
create policy vendors_update on public.vendors
  for update to authenticated
  using (public.has_role(firm_id, '{admin,manager}'))
  with check (public.has_role(firm_id, '{admin,manager}'));
create policy vendors_delete on public.vendors
  for delete to authenticated using (public.has_role(firm_id, '{admin,manager}'));

-- consultants: admin/manager manage; a consultant user also reads their own row
create policy consultants_select on public.consultants
  for select to authenticated
  using (public.has_role(firm_id, '{admin,manager}') or user_id = auth.uid());
create policy consultants_insert on public.consultants
  for insert to authenticated with check (public.has_role(firm_id, '{admin,manager}'));
create policy consultants_update on public.consultants
  for update to authenticated
  using (public.has_role(firm_id, '{admin,manager}'))
  with check (public.has_role(firm_id, '{admin,manager}'));
create policy consultants_delete on public.consultants
  for delete to authenticated using (public.has_role(firm_id, '{admin,manager}'));

-- consultant_cost_rates: admin/manager only
create policy consultant_cost_rates_select on public.consultant_cost_rates
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
create policy consultant_cost_rates_insert on public.consultant_cost_rates
  for insert to authenticated with check (public.has_role(firm_id, '{admin,manager}'));
create policy consultant_cost_rates_update on public.consultant_cost_rates
  for update to authenticated
  using (public.has_role(firm_id, '{admin,manager}'))
  with check (public.has_role(firm_id, '{admin,manager}'));
create policy consultant_cost_rates_delete on public.consultant_cost_rates
  for delete to authenticated using (public.has_role(firm_id, '{admin,manager}'));
