-- Expenses: per-firm expense categories (seeded), expenses, expense-owned
-- attachments and filtered totals.
--
-- Both tables are read and written directly by admins and managers under RLS;
-- consultants see nothing. Rules (trimming, no future dates, retired
-- categories, project -> client) are enforced by the expenses_apply_rules
-- trigger so they hold for every writer.
--
-- Attachments gain a second owner (expense_id). Expense attachment changes
-- lock the expense row (FOR UPDATE); payment attachment changes keep the
-- Phase 4 invoice -> payment lock order via payment_lock.

-- ---------------------------------------------------------------------------
-- Expense categories
-- ---------------------------------------------------------------------------
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint expense_categories_firm_id_id_key unique (firm_id, id),
  constraint expense_categories_name_chk check (char_length(btrim(name)) between 1 and 60)
);
create unique index expense_categories_firm_name_key
  on public.expense_categories (firm_id, lower(btrim(name)));

create function public.expense_categories_trim_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  return new;
end;
$$;

revoke execute on function public.expense_categories_trim_name() from public, anon, authenticated;

create trigger expense_categories_trim_name
  before insert or update on public.expense_categories
  for each row execute function public.expense_categories_trim_name();
create trigger expense_categories_set_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();

alter table public.expense_categories enable row level security;

revoke all on public.expense_categories from anon, authenticated;
grant select, insert, update, delete on public.expense_categories to authenticated;

create policy expense_categories_select on public.expense_categories
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
create policy expense_categories_insert on public.expense_categories
  for insert to authenticated with check (public.has_role(firm_id, '{admin,manager}'));
create policy expense_categories_update on public.expense_categories
  for update to authenticated
  using (public.has_role(firm_id, '{admin,manager}'))
  with check (public.has_role(firm_id, '{admin,manager}'));
create policy expense_categories_delete on public.expense_categories
  for delete to authenticated using (public.has_role(firm_id, '{admin,manager}'));

-- Every firm starts with six categories. Security definer so it works for any
-- inserter (service role, create_firm_with_admin).
create function public.firms_seed_expense_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.expense_categories (firm_id, name)
  select new.id, d.name
  from unnest(array['Travel', 'Software', 'Office', 'Contractors', 'Professional fees', 'Other']) as d(name);
  return null;
end;
$$;

revoke execute on function public.firms_seed_expense_categories() from public, anon, authenticated;

create trigger firms_seed_expense_categories
  after insert on public.firms
  for each row execute function public.firms_seed_expense_categories();

insert into public.expense_categories (firm_id, name)
select f.id, d.name
from public.firms f
cross join unnest(array['Travel', 'Software', 'Office', 'Contractors', 'Professional fees', 'Other']) as d(name)
where not exists (select 1 from public.expense_categories c where c.firm_id = f.id);

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  spent_on date not null,
  category_id uuid not null,
  payee text not null,
  amount numeric(12, 2) not null,
  client_id uuid,
  project_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint expenses_firm_id_id_key unique (firm_id, id),
  constraint expenses_category_fk foreign key (firm_id, category_id)
    references public.expense_categories (firm_id, id) on delete restrict,
  constraint expenses_client_fk foreign key (firm_id, client_id)
    references public.clients (firm_id, id) on delete restrict,
  constraint expenses_project_fk foreign key (firm_id, project_id)
    references public.projects (firm_id, id) on delete restrict,
  constraint expenses_amount_chk check (amount > 0),
  constraint expenses_payee_chk check (char_length(btrim(payee)) between 1 and 200),
  constraint expenses_notes_chk check (notes is null or char_length(notes) <= 1000)
);
create index expenses_firm_spent_on_idx on public.expenses (firm_id, spent_on);
create index expenses_firm_category_idx on public.expenses (firm_id, category_id);
create index expenses_firm_client_idx on public.expenses (firm_id, client_id);
create index expenses_firm_project_idx on public.expenses (firm_id, project_id);

-- Trims, date and category rules, and project -> client. Security definer so
-- the lookups see the category and project whatever the caller can read; both
-- are restricted to the expense's own firm (a foreign id is then left for the
-- composite foreign keys to reject).
create function public.expenses_apply_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
  v_client uuid;
begin
  new.payee := btrim(new.payee);
  new.notes := nullif(btrim(new.notes), '');

  if new.spent_on > current_date then
    raise exception 'EXPENSE_FUTURE' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' or new.category_id is distinct from old.category_id then
    select c.active into v_active
    from public.expense_categories c
    where c.firm_id = new.firm_id and c.id = new.category_id;
    if found and not v_active then
      raise exception 'CATEGORY_RETIRED' using errcode = 'P0001';
    end if;
  end if;

  if new.project_id is not null then
    select p.client_id into v_client
    from public.projects p
    where p.firm_id = new.firm_id and p.id = new.project_id;
    if found then
      new.client_id := v_client;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.expenses_apply_rules() from public, anon, authenticated;

create trigger expenses_apply_rules
  before insert or update on public.expenses
  for each row execute function public.expenses_apply_rules();
create trigger expenses_set_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();
create trigger expenses_audit
  after insert or update or delete on public.expenses
  for each row execute function public.audit_row();

alter table public.expenses enable row level security;

revoke all on public.expenses from anon, authenticated;
grant select, insert, update, delete on public.expenses to authenticated;

create policy expenses_select on public.expenses
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
create policy expenses_insert on public.expenses
  for insert to authenticated with check (public.has_role(firm_id, '{admin,manager}'));
create policy expenses_update on public.expenses
  for update to authenticated
  using (public.has_role(firm_id, '{admin,manager}'))
  with check (public.has_role(firm_id, '{admin,manager}'));
create policy expenses_delete on public.expenses
  for delete to authenticated using (public.has_role(firm_id, '{admin,manager}'));

-- ---------------------------------------------------------------------------
-- Attachments: exactly one owner (payment or expense), and audited.
-- ---------------------------------------------------------------------------
alter table public.attachments
  add column expense_id uuid,
  add constraint attachments_expense_fk foreign key (firm_id, expense_id)
    references public.expenses (firm_id, id) on delete cascade,
  drop constraint attachments_owner_chk,
  add constraint attachments_owner_chk check (num_nonnulls(payment_id, expense_id) = 1);

create index attachments_firm_expense_idx on public.attachments (firm_id, expense_id);

create trigger attachments_audit
  after insert or update or delete on public.attachments
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Record an uploaded file on an expense. The path must be in the expense's
-- own folder: firms/{firm}/attachments/expenses/{expense}/{file}.
-- ---------------------------------------------------------------------------
create function public.add_expense_attachment(
  p_expense uuid,
  p_storage_path text,
  p_file_name text,
  p_mime text,
  p_size integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_exp public.expenses%rowtype;
  v_prefix text;
  v_rest text;
  v_id uuid;
begin
  select * into v_exp from public.expenses e where e.id = p_expense for update;
  if not found then
    raise exception 'EXPENSE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.has_role(v_exp.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  v_prefix := 'firms/' || v_exp.firm_id::text || '/attachments/expenses/' || v_exp.id::text || '/';
  v_rest := substr(p_storage_path, length(v_prefix) + 1);
  if p_storage_path is null
     or left(p_storage_path, length(v_prefix)) <> v_prefix
     or v_rest !~ '^[^/]+$'
     or v_rest in ('.', '..') then
    raise exception 'attachments_path_chk: path is outside the expense folder'
      using errcode = '23514';
  end if;

  insert into public.attachments
    (firm_id, expense_id, storage_path, file_name, mime_type, size_bytes)
  values
    (v_exp.firm_id, v_exp.id, p_storage_path, left(btrim(p_file_name), 120), p_mime, p_size)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.add_expense_attachment(uuid, text, text, text, integer)
  from public, anon;
grant execute on function public.add_expense_attachment(uuid, text, text, text, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Delete an attachment row (payment- or expense-owned). Returns its storage
-- path so the app can remove the file. The payment branch is unchanged from
-- 20261109000018_payments.sql (payment_lock: invoice lock and status rule);
-- the expense branch locks the expense and has no status rule.
-- ---------------------------------------------------------------------------
create or replace function public.delete_attachment(p_attachment uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_att public.attachments%rowtype;
  v_pay public.payments%rowtype;
  v_exp public.expenses%rowtype;
begin
  select * into v_att from public.attachments a where a.id = p_attachment;
  if not found then
    raise exception 'ATTACHMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.has_role(v_att.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_att.expense_id is not null then
    -- Lock the expense, then re-read the attachment. If the expense went
    -- meanwhile, its attachments went with it.
    select * into v_exp from public.expenses e
    where e.id = v_att.expense_id and e.firm_id = v_att.firm_id
    for update;
    if not found then
      raise exception 'ATTACHMENT_NOT_FOUND' using errcode = 'P0001';
    end if;

    if not public.has_role(v_exp.firm_id, '{admin,manager}'::public.firm_role[]) then
      raise exception 'permission denied' using errcode = '42501';
    end if;

    delete from public.attachments a
    where a.id = v_att.id and a.firm_id = v_exp.firm_id and a.expense_id = v_exp.id
    returning a.* into v_att;
    if not found then
      raise exception 'ATTACHMENT_NOT_FOUND' using errcode = 'P0001';
    end if;

    return v_att.storage_path;
  end if;

  -- Lock the owning invoice (then payment), then re-read the attachment.
  -- If the payment went meanwhile, its attachments went with it.
  v_pay := public.payment_lock(v_att.payment_id, 'ATTACHMENT_NOT_FOUND');

  delete from public.attachments a
  where a.id = v_att.id and a.firm_id = v_pay.firm_id and a.payment_id = v_pay.id
  returning a.* into v_att;
  if not found then
    raise exception 'ATTACHMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  return v_att.storage_path;
end;
$$;

revoke execute on function public.delete_attachment(uuid) from public, anon;
grant execute on function public.delete_attachment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Filtered expense total and count. A null filter means "any";
-- p_missing_receipt = true keeps only expenses with no attachment rows.
-- ---------------------------------------------------------------------------
create function public.expense_totals(
  p_firm uuid,
  p_from date,
  p_to date,
  p_category uuid,
  p_client uuid,
  p_project uuid,
  p_missing_receipt boolean
)
returns table (total text, expense_count integer)
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
  select coalesce(sum(e.amount), 0)::numeric(12, 2)::text,
         count(*)::integer
  from public.expenses e
  where e.firm_id = p_firm
    and (p_from is null or e.spent_on >= p_from)
    and (p_to is null or e.spent_on <= p_to)
    and (p_category is null or e.category_id = p_category)
    and (p_client is null or e.client_id = p_client)
    and (p_project is null or e.project_id = p_project)
    and (
      p_missing_receipt is not true
      or not exists (
        select 1 from public.attachments a
        where a.firm_id = e.firm_id and a.expense_id = e.id
      )
    );
end;
$$;

revoke execute on function public.expense_totals(uuid, date, date, uuid, uuid, uuid, boolean)
  from public, anon;
grant execute on function public.expense_totals(uuid, date, date, uuid, uuid, uuid, boolean)
  to authenticated;
