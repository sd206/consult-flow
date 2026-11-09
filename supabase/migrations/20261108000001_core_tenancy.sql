-- Core tenancy: profiles, firms, firm_members, role helpers, RLS, last-admin guard.

-- Nothing is readable by anon; future tables created by the migration role do not
-- inherit Supabase's permissive default grants to anon.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

create type public.firm_role as enum ('admin', 'manager', 'consultant');

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger function (used by every later table)
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  is_platform_owner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  logo_path text,
  address text,
  contact_name text,
  contact_email text,
  contact_phone text,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  default_tax_percent numeric(5, 2) not null default 0
    check (default_tax_percent >= 0 and default_tax_percent <= 100),
  invoice_number_pattern text not null default 'INV-{YYYY}-{SEQ:4}',
  invoice_next_seq integer not null default 1 check (invoice_next_seq >= 1),
  default_payment_terms_days integer not null default 30 check (default_payment_terms_days >= 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table public.firm_members (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  user_id uuid not null references public.profiles (user_id),
  role public.firm_role not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint firm_members_firm_user_key unique (firm_id, user_id),
  constraint firm_members_firm_id_id_key unique (firm_id, id)
);
create index firm_members_user_id_idx on public.firm_members (user_id);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger firms_set_updated_at before update on public.firms
  for each row execute function public.set_updated_at();
create trigger firm_members_set_updated_at before update on public.firm_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so they bypass RLS on firm_members/profiles)
-- ---------------------------------------------------------------------------
create function public.is_member(p_firm uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.firm_members m
    where m.firm_id = p_firm and m.user_id = auth.uid()
  );
$$;

create function public.has_role(p_firm uuid, p_roles public.firm_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.firm_members m
    where m.firm_id = p_firm
      and m.user_id = auth.uid()
      and m.role = any (p_roles)
  );
$$;

create function public.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_platform_owner from public.profiles p where p.user_id = auth.uid()),
    false
  );
$$;

-- Platform owner's only window onto firms: names and admin emails, no business data.
create function public.platform_list_firms()
returns table (id uuid, name text, created_at timestamptz, admin_emails text[])
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.id,
    f.name,
    f.created_at,
    array(
      select p.email
      from public.firm_members m
      join public.profiles p on p.user_id = m.user_id
      where m.firm_id = f.id and m.role = 'admin'
      order by p.email
    ) as admin_emails
  from public.firms f
  where public.is_platform_owner()
  order by f.created_at;
$$;

revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.has_role(uuid, public.firm_role[]) from public, anon;
revoke execute on function public.is_platform_owner() from public, anon;
revoke execute on function public.platform_list_firms() from public, anon;
grant execute on function public.is_member(uuid) to authenticated, service_role;
grant execute on function public.has_role(uuid, public.firm_role[]) to authenticated, service_role;
grant execute on function public.is_platform_owner() to authenticated, service_role;
grant execute on function public.platform_list_firms() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Signup trigger: every auth user gets a profile
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Last-admin guard (applies to every caller, including the service role)
-- ---------------------------------------------------------------------------
create function public.guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.firm_id <> old.firm_id) then
    -- serialize concurrent admin removals within one firm
    perform pg_advisory_xact_lock(hashtextextended(old.firm_id::text, 0));
    if not exists (
      select 1 from public.firm_members m
      where m.firm_id = old.firm_id and m.role = 'admin' and m.id <> old.id
    ) then
      raise exception 'LAST_ADMIN' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_last_admin() from public, anon, authenticated;

create trigger guard_last_admin
  before update or delete on public.firm_members
  for each row execute function public.guard_last_admin();

-- ---------------------------------------------------------------------------
-- Privileges (column-level restrictions) and RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.firms enable row level security;
alter table public.firm_members enable row level security;

revoke all on public.profiles, public.firms, public.firm_members from anon, authenticated;

grant select on public.profiles, public.firms, public.firm_members to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant update (
  name, logo_path, address, contact_name, contact_email, contact_phone,
  currency, default_tax_percent, invoice_number_pattern, invoice_next_seq,
  default_payment_terms_days
) on public.firms to authenticated;
grant update (role) on public.firm_members to authenticated;
grant delete on public.firm_members to authenticated;

-- profiles: own row, or a user who shares a firm with the caller. No insert/delete.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.firm_members m
      where m.user_id = profiles.user_id and public.is_member(m.firm_id)
    )
  );
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- firms: members read; admins update. Inserts/deletes via service role only.
create policy firms_select on public.firms
  for select to authenticated
  using (public.is_member(id));
create policy firms_update on public.firms
  for update to authenticated
  using (public.has_role(id, '{admin}'))
  with check (public.has_role(id, '{admin}'));

-- firm_members: members read; admins change role / remove others. Inserts via service role only.
create policy firm_members_select on public.firm_members
  for select to authenticated
  using (public.is_member(firm_id));
create policy firm_members_update on public.firm_members
  for update to authenticated
  using (public.has_role(firm_id, '{admin}'))
  with check (public.has_role(firm_id, '{admin}'));
create policy firm_members_delete on public.firm_members
  for delete to authenticated
  using (public.has_role(firm_id, '{admin}') and user_id <> auth.uid());
