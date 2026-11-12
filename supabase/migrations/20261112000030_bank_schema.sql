-- Bank statement import: accounts, imports, lines, and other income.
-- Spec: docs/superpowers/specs/2026-11-12-bank-import-design.md

-- ---------------------------------------------------------------------------
-- Other income categories (same shape and rules as expense_categories)
-- ---------------------------------------------------------------------------
create table public.other_income_categories (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint other_income_categories_firm_id_id_key unique (firm_id, id),
  constraint other_income_categories_name_chk check (char_length(btrim(name)) between 1 and 60)
);
create unique index other_income_categories_firm_name_key
  on public.other_income_categories (firm_id, lower(btrim(name)));

create trigger other_income_categories_trim_name
  before insert or update on public.other_income_categories
  for each row execute function public.expense_categories_trim_name();
create trigger other_income_categories_set_updated_at before update on public.other_income_categories
  for each row execute function public.set_updated_at();

alter table public.other_income_categories enable row level security;
revoke all on public.other_income_categories from anon, authenticated;
grant select, insert, update, delete on public.other_income_categories to authenticated;
create policy other_income_categories_select on public.other_income_categories
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
create policy other_income_categories_insert on public.other_income_categories
  for insert to authenticated with check (public.has_role(firm_id, '{admin,manager}'));
create policy other_income_categories_update on public.other_income_categories
  for update to authenticated
  using (public.has_role(firm_id, '{admin,manager}'))
  with check (public.has_role(firm_id, '{admin,manager}'));
create policy other_income_categories_delete on public.other_income_categories
  for delete to authenticated using (public.has_role(firm_id, '{admin,manager}'));

create function public.firms_seed_other_income_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.other_income_categories (firm_id, name)
  select new.id, d.name
  from unnest(array['Interest', 'Refund', 'Owner contribution', 'Other']) as d(name);
  return null;
end;
$$;
revoke execute on function public.firms_seed_other_income_categories() from public, anon, authenticated;
create trigger firms_seed_other_income_categories
  after insert on public.firms
  for each row execute function public.firms_seed_other_income_categories();

insert into public.other_income_categories (firm_id, name)
select f.id, d.name
from public.firms f
cross join unnest(array['Interest', 'Refund', 'Owner contribution', 'Other']) as d(name)
where not exists (select 1 from public.other_income_categories c where c.firm_id = f.id);

-- ---------------------------------------------------------------------------
-- Other income
-- ---------------------------------------------------------------------------
create table public.other_income (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  received_on date not null,
  category_id uuid not null,
  source text not null,
  amount numeric(12, 2) not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint other_income_firm_id_id_key unique (firm_id, id),
  constraint other_income_category_fk foreign key (firm_id, category_id)
    references public.other_income_categories (firm_id, id) on delete restrict,
  constraint other_income_amount_chk check (amount > 0),
  constraint other_income_source_chk check (char_length(btrim(source)) between 1 and 120),
  constraint other_income_notes_len_chk check (notes is null or char_length(notes) <= 1000)
);
create index other_income_firm_date_idx on public.other_income (firm_id, received_on);

create function public.other_income_apply_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
begin
  new.source := btrim(new.source);
  new.notes := nullif(btrim(new.notes), '');
  if new.received_on > current_date then
    raise exception 'INCOME_FUTURE' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' or new.category_id is distinct from old.category_id then
    select c.active into v_active
    from public.other_income_categories c
    where c.firm_id = new.firm_id and c.id = new.category_id;
    if found and not v_active then
      raise exception 'CATEGORY_RETIRED' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.other_income_apply_rules() from public, anon, authenticated;

create trigger other_income_apply_rules
  before insert or update on public.other_income
  for each row execute function public.other_income_apply_rules();
create trigger other_income_set_updated_at before update on public.other_income
  for each row execute function public.set_updated_at();
create trigger other_income_audit
  after insert or update or delete on public.other_income
  for each row execute function public.audit_row();

alter table public.other_income enable row level security;
revoke all on public.other_income from anon, authenticated;
grant select, insert, update, delete on public.other_income to authenticated;
create policy other_income_select on public.other_income
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
create policy other_income_insert on public.other_income
  for insert to authenticated with check (public.has_role(firm_id, '{admin,manager}'));
create policy other_income_update on public.other_income
  for update to authenticated
  using (public.has_role(firm_id, '{admin,manager}'))
  with check (public.has_role(firm_id, '{admin,manager}'));
create policy other_income_delete on public.other_income
  for delete to authenticated using (public.has_role(firm_id, '{admin,manager}'));

-- ---------------------------------------------------------------------------
-- Bank accounts
-- ---------------------------------------------------------------------------
create type public.bank_account_kind as enum ('bank', 'credit_card');

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  name text not null,
  kind public.bank_account_kind not null,
  last4 text,
  csv_mapping jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint bank_accounts_firm_id_id_key unique (firm_id, id),
  constraint bank_accounts_name_chk check (char_length(btrim(name)) between 1 and 60),
  constraint bank_accounts_last4_chk check (last4 is null or last4 ~ '^[0-9]{4}$')
);
create unique index bank_accounts_firm_name_key on public.bank_accounts (firm_id, lower(btrim(name)));

create trigger bank_accounts_trim_name
  before insert or update on public.bank_accounts
  for each row execute function public.expense_categories_trim_name();
create trigger bank_accounts_set_updated_at before update on public.bank_accounts
  for each row execute function public.set_updated_at();
create trigger bank_accounts_audit
  after insert or update or delete on public.bank_accounts
  for each row execute function public.audit_row();

alter table public.bank_accounts enable row level security;
revoke all on public.bank_accounts from anon, authenticated;
grant select, insert, update, delete on public.bank_accounts to authenticated;
create policy bank_accounts_select on public.bank_accounts
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
create policy bank_accounts_insert on public.bank_accounts
  for insert to authenticated with check (public.has_role(firm_id, '{admin,manager}'));
create policy bank_accounts_update on public.bank_accounts
  for update to authenticated
  using (public.has_role(firm_id, '{admin,manager}'))
  with check (public.has_role(firm_id, '{admin,manager}'));
create policy bank_accounts_delete on public.bank_accounts
  for delete to authenticated using (public.has_role(firm_id, '{admin,manager}'));

-- ---------------------------------------------------------------------------
-- Imports and lines (read-only to the app; written by the bank functions)
-- ---------------------------------------------------------------------------
create table public.bank_imports (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  account_id uuid not null,
  file_name text not null,
  format text not null,
  line_count integer not null default 0,
  duplicate_count integer not null default 0,
  imported_at timestamptz not null default now(),
  imported_by uuid default auth.uid(),
  constraint bank_imports_firm_id_id_key unique (firm_id, id),
  constraint bank_imports_account_fk foreign key (firm_id, account_id)
    references public.bank_accounts (firm_id, id) on delete restrict,
  constraint bank_imports_format_chk check (format in ('ofx', 'csv')),
  constraint bank_imports_file_name_chk check (char_length(file_name) between 1 and 255)
);

create type public.bank_line_status as enum ('new', 'done', 'ignored');

create table public.bank_lines (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  account_id uuid not null,
  import_id uuid,
  posted_on date not null,
  amount numeric(12, 2) not null,
  description text not null,
  clean_description text not null,
  bank_ref text,
  dedupe_key text not null,
  status public.bank_line_status not null default 'new',
  ignore_reason text,
  payment_id uuid,
  expense_id uuid,
  other_income_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_lines_firm_id_id_key unique (firm_id, id),
  constraint bank_lines_dedupe_key unique (account_id, dedupe_key),
  constraint bank_lines_account_fk foreign key (firm_id, account_id)
    references public.bank_accounts (firm_id, id) on delete restrict,
  constraint bank_lines_import_fk foreign key (firm_id, import_id)
    references public.bank_imports (firm_id, id) on delete restrict,
  constraint bank_lines_payment_fk foreign key (firm_id, payment_id)
    references public.payments (firm_id, id) on delete set null (payment_id),
  constraint bank_lines_expense_fk foreign key (firm_id, expense_id)
    references public.expenses (firm_id, id) on delete set null (expense_id),
  constraint bank_lines_other_income_fk foreign key (firm_id, other_income_id)
    references public.other_income (firm_id, id) on delete set null (other_income_id),
  constraint bank_lines_amount_chk check (amount <> 0),
  constraint bank_lines_description_chk check (char_length(description) between 1 and 500),
  constraint bank_lines_one_link_chk check (num_nonnulls(payment_id, expense_id, other_income_id) <= 1),
  constraint bank_lines_done_chk check ((status = 'done') = (num_nonnulls(payment_id, expense_id, other_income_id) = 1)),
  constraint bank_lines_reason_chk check (status = 'ignored' or ignore_reason is null),
  constraint bank_lines_reason_len_chk check (ignore_reason is null or char_length(ignore_reason) <= 200)
);
create index bank_lines_account_status_idx on public.bank_lines (account_id, status, posted_on);
create index bank_lines_firm_clean_idx on public.bank_lines (firm_id, clean_description) where expense_id is not null;
create unique index bank_lines_payment_key on public.bank_lines (payment_id) where payment_id is not null;
create unique index bank_lines_expense_key on public.bank_lines (expense_id) where expense_id is not null;
create unique index bank_lines_other_income_key on public.bank_lines (other_income_id) where other_income_id is not null;

-- A linked record deleted elsewhere (FK sets the link to null) returns the line to New.
create function public.bank_lines_reset_unlinked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' and num_nonnulls(new.payment_id, new.expense_id, new.other_income_id) = 0 then
    new.status := 'new';
  end if;
  return new;
end;
$$;
revoke execute on function public.bank_lines_reset_unlinked() from public, anon, authenticated;
create trigger bank_lines_reset_unlinked
  before update on public.bank_lines
  for each row execute function public.bank_lines_reset_unlinked();
create trigger bank_lines_set_updated_at before update on public.bank_lines
  for each row execute function public.set_updated_at();

alter table public.bank_imports enable row level security;
alter table public.bank_lines enable row level security;
revoke all on public.bank_imports from anon, authenticated;
revoke all on public.bank_lines from anon, authenticated;
grant select on public.bank_imports to authenticated;
grant select on public.bank_lines to authenticated;
create policy bank_imports_select on public.bank_imports
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
create policy bank_lines_select on public.bank_lines
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
