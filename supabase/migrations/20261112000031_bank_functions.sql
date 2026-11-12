-- Bank import and review functions. Each review action locks its line, checks
-- it is still in the expected state (LINE_HANDLED otherwise), creates or links
-- the record and marks the line, all in one transaction.

-- Lock a line for review. Internal: callable only from the functions below.
create function public.bank_lock_line(p_line uuid, p_statuses public.bank_line_status[])
returns public.bank_lines
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.bank_lines%rowtype;
begin
  select * into v from public.bank_lines l where l.id = p_line for update;
  if not found then
    raise exception 'LINE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.has_role(v.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not (v.status = any (p_statuses)) then
    raise exception 'LINE_HANDLED' using errcode = 'P0001';
  end if;
  return v;
end;
$$;
revoke execute on function public.bank_lock_line(uuid, public.bank_line_status[]) from public, anon, authenticated;

-- Account lookup with the role check. Internal.
create function public.bank_account_checked(p_account uuid)
returns public.bank_accounts
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.bank_accounts%rowtype;
begin
  select * into v from public.bank_accounts a where a.id = p_account;
  if not found then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.has_role(v.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke execute on function public.bank_account_checked(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Import
-- ---------------------------------------------------------------------------
create function public.import_bank_lines(p_account uuid, p_file_name text, p_format text, p_lines jsonb)
returns table (import_id uuid, inserted integer, duplicates integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_acct public.bank_accounts%rowtype;
  v_import uuid;
  v_total integer;
  v_inserted integer;
begin
  v_acct := public.bank_account_checked(p_account);
  if not v_acct.active then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'invalid lines' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_lines);
  if v_total > 5000 then
    raise exception 'TOO_MANY_LINES' using errcode = 'P0001';
  end if;

  insert into public.bank_imports (firm_id, account_id, file_name, format)
  values (v_acct.firm_id, v_acct.id, left(coalesce(nullif(btrim(p_file_name), ''), 'statement'), 255), p_format)
  returning id into v_import;

  insert into public.bank_lines (
    firm_id, account_id, import_id, posted_on, amount, description, clean_description, bank_ref, dedupe_key
  )
  select v_acct.firm_id, v_acct.id, v_import, r.posted_on, r.amount, left(r.description, 500),
         left(r.clean_description, 80), nullif(left(r.bank_ref, 255), ''), r.dedupe_key
  from jsonb_to_recordset(p_lines) as r(
    posted_on date, amount numeric, description text, clean_description text, bank_ref text, dedupe_key text
  )
  on conflict (account_id, dedupe_key) do nothing;
  get diagnostics v_inserted = row_count;

  update public.bank_imports
  set line_count = v_inserted, duplicate_count = v_total - v_inserted
  where id = v_import;

  return query select v_import, v_inserted, v_total - v_inserted;
end;
$$;

create function public.save_csv_mapping(p_account uuid, p_mapping jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.bank_account_checked(p_account);
  update public.bank_accounts set csv_mapping = p_mapping where id = p_account;
end;
$$;

-- ---------------------------------------------------------------------------
-- Review actions
-- ---------------------------------------------------------------------------
create function public.confirm_bank_line_payment(p_line uuid, p_invoice uuid, p_notes text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.bank_lines%rowtype;
  v_kind public.bank_account_kind;
  v_id uuid;
begin
  v := public.bank_lock_line(p_line, '{new}');
  if v.amount <= 0 then
    raise exception 'LINE_DIRECTION' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.invoices i where i.id = p_invoice and i.firm_id = v.firm_id) then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;
  select a.kind into v_kind from public.bank_accounts a where a.id = v.account_id;

  v_id := public.record_payment(
    p_invoice,
    v.amount,
    v.posted_on,
    (case when v_kind = 'credit_card' then 'card' else 'bank_transfer' end)::public.payment_method,
    coalesce(v.bank_ref, left(v.description, 120)),
    p_notes
  );
  update public.bank_lines set payment_id = v_id, status = 'done' where id = v.id;
  return v_id;
end;
$$;

create function public.confirm_bank_line_expense(
  p_line uuid, p_payee text, p_category uuid, p_client uuid, p_project uuid, p_notes text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.bank_lines%rowtype;
  v_id uuid;
begin
  v := public.bank_lock_line(p_line, '{new}');
  if v.amount >= 0 then
    raise exception 'LINE_DIRECTION' using errcode = 'P0001';
  end if;
  insert into public.expenses (firm_id, spent_on, category_id, payee, amount, client_id, project_id, notes)
  values (v.firm_id, v.posted_on, p_category, p_payee, -v.amount, p_client, p_project, p_notes)
  returning id into v_id;
  update public.bank_lines set expense_id = v_id, status = 'done' where id = v.id;
  return v_id;
end;
$$;

create function public.confirm_bank_line_other_income(p_line uuid, p_category uuid, p_source text, p_notes text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.bank_lines%rowtype;
  v_id uuid;
begin
  v := public.bank_lock_line(p_line, '{new}');
  if v.amount <= 0 then
    raise exception 'LINE_DIRECTION' using errcode = 'P0001';
  end if;
  insert into public.other_income (firm_id, received_on, category_id, source, amount, notes)
  values (v.firm_id, v.posted_on, p_category, p_source, v.amount, p_notes)
  returning id into v_id;
  update public.bank_lines set other_income_id = v_id, status = 'done' where id = v.id;
  return v_id;
end;
$$;

create function public.link_bank_line(p_line uuid, p_payment uuid, p_expense uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.bank_lines%rowtype;
  v_amount numeric;
begin
  v := public.bank_lock_line(p_line, '{new}');
  if num_nonnulls(p_payment, p_expense) <> 1 then
    raise exception 'choose one entry to link' using errcode = '22023';
  end if;

  if p_payment is not null then
    select p.amount into v_amount from public.payments p where p.id = p_payment and p.firm_id = v.firm_id;
    if not found then
      raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_amount <> v.amount then
      raise exception 'LINK_MISMATCH' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.bank_lines l where l.payment_id = p_payment) then
      raise exception 'ALREADY_LINKED' using errcode = 'P0001';
    end if;
    update public.bank_lines set payment_id = p_payment, status = 'done' where id = v.id;
  else
    select e.amount into v_amount from public.expenses e where e.id = p_expense and e.firm_id = v.firm_id;
    if not found then
      raise exception 'EXPENSE_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_amount <> -v.amount then
      raise exception 'LINK_MISMATCH' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.bank_lines l where l.expense_id = p_expense) then
      raise exception 'ALREADY_LINKED' using errcode = 'P0001';
    end if;
    update public.bank_lines set expense_id = p_expense, status = 'done' where id = v.id;
  end if;
end;
$$;

create function public.ignore_bank_lines(p_lines uuid[], p_reason text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if exists (
    select 1 from public.bank_lines l
    where l.id = any (p_lines) and not public.has_role(l.firm_id, '{admin,manager}'::public.firm_role[])
  ) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.bank_lines l
  set status = 'ignored', ignore_reason = nullif(btrim(p_reason), '')
  where l.id = any (p_lines) and l.status = 'new';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Back to New. Unlinks only; the payment, expense or other income stays.
create function public.reset_bank_line(p_line uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.bank_lines%rowtype;
begin
  v := public.bank_lock_line(p_line, '{done,ignored}');
  update public.bank_lines
  set status = 'new', ignore_reason = null, payment_id = null, expense_id = null, other_income_id = null
  where id = v.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads for the review screen
-- ---------------------------------------------------------------------------
create function public.list_bank_lines(p_account uuid, p_status text)
returns table (
  id uuid,
  posted_on date,
  amount text,
  description text,
  bank_ref text,
  status text,
  ignore_reason text,
  payment_id uuid,
  expense_id uuid,
  other_income_id uuid,
  linked_label text,
  suggested_category_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acct public.bank_accounts%rowtype;
begin
  v_acct := public.bank_account_checked(p_account);
  if p_status is null or p_status not in ('new', 'done', 'ignored') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  return query
  select l.id, l.posted_on, l.amount::text, l.description, l.bank_ref, l.status::text, l.ignore_reason,
         l.payment_id, l.expense_id, l.other_income_id,
         coalesce(
           (select coalesce(i.number, 'Payment') from public.payments p
            join public.invoices i on i.firm_id = p.firm_id and i.id = p.invoice_id
            where p.id = l.payment_id),
           (select e.payee from public.expenses e where e.id = l.expense_id),
           (select o.source from public.other_income o where o.id = l.other_income_id)
         ),
         case when l.status = 'new' and l.amount < 0 then (
           select e.category_id
           from public.bank_lines h
           join public.expenses e on e.firm_id = h.firm_id and e.id = h.expense_id
           where h.firm_id = l.firm_id and h.clean_description = l.clean_description and h.expense_id is not null
           order by h.updated_at desc
           limit 1
         ) end
  from public.bank_lines l
  where l.account_id = v_acct.id and l.status = p_status::public.bank_line_status
  order by
    case when p_status = 'new' then l.posted_on end asc,
    case when p_status <> 'new' then l.posted_on end desc,
    l.created_at, l.id
  limit 500;
end;
$$;

create function public.bank_match_candidates(p_line uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.bank_lines%rowtype;
  v_invoices jsonb := '[]';
  v_payments jsonb := '[]';
  v_expenses jsonb := '[]';
begin
  select * into v from public.bank_lines l where l.id = p_line;
  if not found then
    raise exception 'LINE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.has_role(v.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v.amount > 0 then
    select coalesce(jsonb_agg(x order by x.number), '[]') into v_invoices
    from (
      select i.id, i.number, c.name as client_name, (i.total - i.amount_paid)::numeric(12, 2)::text as balance_due
      from public.invoices i
      join public.clients c on c.firm_id = i.firm_id and c.id = i.client_id
      where i.firm_id = v.firm_id and i.status in ('issued', 'partly_paid')
      order by i.number
      limit 200
    ) x;

    select coalesce(jsonb_agg(x order by x.paid_on), '[]') into v_payments
    from (
      select p.id, p.paid_on, p.amount::text as amount, i.number as invoice_number, c.name as client_name
      from public.payments p
      join public.invoices i on i.firm_id = p.firm_id and i.id = p.invoice_id
      join public.clients c on c.firm_id = i.firm_id and c.id = i.client_id
      where p.firm_id = v.firm_id
        and p.amount = v.amount
        and p.paid_on between v.posted_on - 7 and v.posted_on + 7
        and not exists (select 1 from public.bank_lines l where l.payment_id = p.id)
      limit 20
    ) x;
  else
    select coalesce(jsonb_agg(x order by x.spent_on), '[]') into v_expenses
    from (
      select e.id, e.spent_on, e.amount::text as amount, e.payee
      from public.expenses e
      where e.firm_id = v.firm_id
        and e.amount = -v.amount
        and e.spent_on between v.posted_on - 7 and v.posted_on + 7
        and not exists (select 1 from public.bank_lines l where l.expense_id = e.id)
      limit 20
    ) x;
  end if;

  return jsonb_build_object('invoices', v_invoices, 'payments', v_payments, 'expenses', v_expenses);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.import_bank_lines(uuid, text, text, jsonb) from public, anon;
grant execute on function public.import_bank_lines(uuid, text, text, jsonb) to authenticated;
revoke execute on function public.save_csv_mapping(uuid, jsonb) from public, anon;
grant execute on function public.save_csv_mapping(uuid, jsonb) to authenticated;
revoke execute on function public.confirm_bank_line_payment(uuid, uuid, text) from public, anon;
grant execute on function public.confirm_bank_line_payment(uuid, uuid, text) to authenticated;
revoke execute on function public.confirm_bank_line_expense(uuid, text, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.confirm_bank_line_expense(uuid, text, uuid, uuid, uuid, text) to authenticated;
revoke execute on function public.confirm_bank_line_other_income(uuid, uuid, text, text) from public, anon;
grant execute on function public.confirm_bank_line_other_income(uuid, uuid, text, text) to authenticated;
revoke execute on function public.link_bank_line(uuid, uuid, uuid) from public, anon;
grant execute on function public.link_bank_line(uuid, uuid, uuid) to authenticated;
revoke execute on function public.ignore_bank_lines(uuid[], text) from public, anon;
grant execute on function public.ignore_bank_lines(uuid[], text) to authenticated;
revoke execute on function public.reset_bank_line(uuid) from public, anon;
grant execute on function public.reset_bank_line(uuid) to authenticated;
revoke execute on function public.list_bank_lines(uuid, text) from public, anon;
grant execute on function public.list_bank_lines(uuid, text) to authenticated;
revoke execute on function public.bank_match_candidates(uuid) from public, anon;
grant execute on function public.bank_match_candidates(uuid) to authenticated;
