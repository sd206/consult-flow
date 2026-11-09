-- Invoicing schema: templates (one default per firm), invoices, invoice lines,
-- the time_entries -> invoice_lines link, and invoice number formatting.
-- Invoices and lines are read-only to clients; Tasks 3-4 functions write them.

create type public.invoice_status as enum ('draft', 'issued', 'partly_paid', 'paid', 'void');
create type public.invoice_layout as enum ('classic', 'modern', 'compact');
create type public.invoice_line_kind as enum ('time', 'manual');
create type public.invoice_discount_type as enum ('none', 'percent', 'amount');

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------
create table public.invoice_templates (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  name text not null,
  base_layout public.invoice_layout not null default 'classic',
  options jsonb not null default '{}',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint invoice_templates_firm_id_id_key unique (firm_id, id),
  constraint invoice_templates_name_chk check (length(btrim(name)) > 0),
  constraint invoice_templates_accent_chk check (
    options ->> 'accentColor' is null or options ->> 'accentColor' ~ '^#[0-9A-Fa-f]{6}$'
  )
);
create unique index invoice_templates_firm_name_key
  on public.invoice_templates (firm_id, lower(name));
create unique index invoice_templates_one_default
  on public.invoice_templates (firm_id) where is_default;

create trigger invoice_templates_set_updated_at before update on public.invoice_templates
  for each row execute function public.set_updated_at();
create trigger invoice_templates_audit
  after insert or update or delete on public.invoice_templates
  for each row execute function public.audit_row();

create function public.invoice_templates_guard_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_default then
    raise exception 'TEMPLATE_IS_DEFAULT' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

revoke execute on function public.invoice_templates_guard_default() from public, anon, authenticated;

create trigger invoice_templates_guard_default
  before delete on public.invoice_templates
  for each row execute function public.invoice_templates_guard_default();

alter table public.invoice_templates enable row level security;

revoke all on public.invoice_templates from anon, authenticated;
grant select, insert, update, delete on public.invoice_templates to authenticated;

create policy invoice_templates_select on public.invoice_templates
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
create policy invoice_templates_insert on public.invoice_templates
  for insert to authenticated with check (public.has_role(firm_id, '{admin}'));
create policy invoice_templates_update on public.invoice_templates
  for update to authenticated
  using (public.has_role(firm_id, '{admin}'))
  with check (public.has_role(firm_id, '{admin}'));
create policy invoice_templates_delete on public.invoice_templates
  for delete to authenticated using (public.has_role(firm_id, '{admin}'));

-- Every firm starts with a default "Standard" template. Security definer so it
-- works for any inserter (service role, create_firm_with_admin).
create function public.firms_seed_invoice_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.invoice_templates (firm_id, name, base_layout, options, is_default)
  values (new.id, 'Standard', 'classic', '{}', true);
  return null;
end;
$$;

revoke execute on function public.firms_seed_invoice_template() from public, anon, authenticated;

create trigger firms_seed_invoice_template
  after insert on public.firms
  for each row execute function public.firms_seed_invoice_template();

insert into public.invoice_templates (firm_id, name, base_layout, options, is_default)
select f.id, 'Standard', 'classic', '{}', true
from public.firms f
where not exists (select 1 from public.invoice_templates t where t.firm_id = f.id);

-- Make a template the firm's default. Admins only.
create function public.set_default_template(p_template uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_firm uuid;
begin
  select t.firm_id into v_firm from public.invoice_templates t where t.id = p_template;
  if not found then
    raise exception 'TEMPLATE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.has_role(v_firm, '{admin}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- Lock the firm's templates so concurrent calls serialize.
  perform 1 from public.invoice_templates t
  where t.firm_id = v_firm
  order by t.id
  for update;

  -- Clear first, then set, so invoice_templates_one_default never sees two.
  update public.invoice_templates t
  set is_default = false
  where t.firm_id = v_firm and t.is_default and t.id <> p_template;

  update public.invoice_templates t
  set is_default = true
  where t.firm_id = v_firm and t.id = p_template and not t.is_default;
end;
$$;

revoke execute on function public.set_default_template(uuid) from public, anon;
grant execute on function public.set_default_template(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  client_id uuid not null,
  template_id uuid not null,
  number text,
  subject text,
  period_start date not null,
  period_end date not null,
  issue_date date not null,
  due_date date not null,
  status public.invoice_status not null default 'draft',
  currency text not null,
  subtotal numeric(12, 2) not null default 0,
  discount_type public.invoice_discount_type not null default 'none',
  discount_value numeric(12, 2) not null default 0,
  discount_label text,
  discount_amount numeric(12, 2) not null default 0,
  tax_percent numeric(5, 2) not null default 0,
  tax_amount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  amount_paid numeric(12, 2) not null default 0,
  pdf_path text,
  bill_to_name text,
  bill_to_contact_name text,
  bill_to_email text,
  bill_to_phone text,
  bill_to_address text,
  from_name text,
  from_address text,
  from_contact_name text,
  from_contact_email text,
  from_contact_phone text,
  from_logo_path text,
  issued_at timestamptz,
  issued_by uuid references public.profiles (user_id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint invoices_firm_id_id_key unique (firm_id, id),
  constraint invoices_client_fk foreign key (firm_id, client_id)
    references public.clients (firm_id, id) on delete restrict,
  constraint invoices_template_fk foreign key (firm_id, template_id)
    references public.invoice_templates (firm_id, id) on delete restrict,
  constraint invoices_period_chk check (period_end >= period_start),
  constraint invoices_due_chk check (due_date >= issue_date),
  constraint invoices_tax_chk check (tax_percent between 0 and 100),
  constraint invoices_money_chk check (
    subtotal >= 0 and tax_amount >= 0 and total >= 0 and amount_paid >= 0
    and discount_amount >= 0 and discount_amount <= subtotal
  ),
  constraint invoices_discount_chk check (
    (discount_type = 'none' and discount_value = 0)
    or (discount_type = 'percent' and discount_value between 0 and 100)
    or (discount_type = 'amount' and discount_value >= 0)
  ),
  constraint invoices_number_chk check ((status = 'draft') = (number is null)),
  constraint invoices_pdf_path_chk check (
    pdf_path is null
    or pdf_path like ('firms/' || firm_id::text || '/invoices/' || id::text || '/%')
  )
);
create unique index invoices_firm_number_key
  on public.invoices (firm_id, number) where number is not null;
create index invoices_firm_status_issue_idx on public.invoices (firm_id, status, issue_date);
create index invoices_firm_client_idx on public.invoices (firm_id, client_id);
create index invoices_firm_template_idx on public.invoices (firm_id, template_id);

create trigger invoices_set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();
create trigger invoices_audit
  after insert or update or delete on public.invoices
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Invoice lines
-- ---------------------------------------------------------------------------
create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  invoice_id uuid not null,
  kind public.invoice_line_kind not null,
  consultant_id uuid,
  project_id uuid,
  description text not null,
  quantity numeric(9, 2) not null,
  unit_price numeric(12, 2) not null,
  amount numeric(12, 2) not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint invoice_lines_firm_id_id_key unique (firm_id, id),
  constraint invoice_lines_invoice_fk foreign key (firm_id, invoice_id)
    references public.invoices (firm_id, id) on delete cascade,
  constraint invoice_lines_consultant_fk foreign key (firm_id, consultant_id)
    references public.consultants (firm_id, id) on delete restrict,
  constraint invoice_lines_project_fk foreign key (firm_id, project_id)
    references public.projects (firm_id, id) on delete restrict,
  constraint invoice_lines_kind_chk
    check ((kind = 'time') = (consultant_id is not null and project_id is not null)),
  constraint invoice_lines_quantity_chk check (quantity > 0),
  constraint invoice_lines_money_chk check (unit_price >= 0 and amount >= 0),
  constraint invoice_lines_description_chk check (length(btrim(description)) > 0)
);
create index invoice_lines_invoice_sort_idx
  on public.invoice_lines (firm_id, invoice_id, sort_order);
create index invoice_lines_consultant_idx on public.invoice_lines (firm_id, consultant_id)
  where consultant_id is not null;
create index invoice_lines_project_idx on public.invoice_lines (firm_id, project_id)
  where project_id is not null;

create trigger invoice_lines_set_updated_at before update on public.invoice_lines
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges and RLS: admins/managers read; no direct writes.
-- ---------------------------------------------------------------------------
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;

revoke all on public.invoices, public.invoice_lines from anon, authenticated;
grant select on public.invoices, public.invoice_lines to authenticated;

create policy invoices_select on public.invoices
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
create policy invoice_lines_select on public.invoice_lines
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));

-- ---------------------------------------------------------------------------
-- Link invoiced time entries to their line (unlinked when the line goes).
-- ---------------------------------------------------------------------------
alter table public.time_entries
  add constraint time_entries_invoice_line_fk foreign key (firm_id, invoice_line_id)
    references public.invoice_lines (firm_id, id) on delete set null (invoice_line_id);
create index time_entries_invoice_line_idx on public.time_entries (firm_id, invoice_line_id)
  where invoice_line_id is not null;

-- ---------------------------------------------------------------------------
-- Invoice number formatting; mirrors formatInvoiceNumber (single left-to-right
-- pass, so substituted digits are never re-read as tokens).
-- ---------------------------------------------------------------------------
create function public.format_invoice_number(p_pattern text, p_seq integer, p_issue date)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_token constant text := '\{(YYYY|YY|MM|SEQ:([0-9]+))\}';
  v_literals text[] := regexp_split_to_array(p_pattern, c_token);
  v_yyyy text := to_char(p_issue, 'YYYY');
  v_seq text := p_seq::text;
  v_out text := v_literals[1];
  v_i integer := 1;
  v_m text[];
  v_width integer;
begin
  for v_m in select regexp_matches(p_pattern, c_token, 'g') loop
    v_i := v_i + 1;
    if v_m[1] = 'YYYY' then
      v_out := v_out || v_yyyy;
    elsif v_m[1] = 'YY' then
      v_out := v_out || substr(v_yyyy, 3);
    elsif v_m[1] = 'MM' then
      v_out := v_out || to_char(p_issue, 'MM');
    else
      v_width := v_m[2]::integer;
      -- lpad truncates; wider numbers must be kept whole.
      v_out := v_out || case when length(v_seq) >= v_width then v_seq
                             else lpad(v_seq, v_width, '0') end;
    end if;
    v_out := v_out || v_literals[v_i];
  end loop;
  return v_out;
end;
$$;

revoke execute on function public.format_invoice_number(text, integer, date) from public, anon;
grant execute on function public.format_invoice_number(text, integer, date) to authenticated;
