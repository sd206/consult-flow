-- Phase 3 final review fixes.
--
-- 1. Drafts remember their consultant selection (invoices.consultant_filter:
--    null = all consultants, including ones that appear later; empty array =
--    none). create_invoice_draft, regenerate_invoice_lines and
--    update_invoice_period store the p_consultants they receive.
-- 2. Templates: clients may only write name, base_layout and options (plus
--    firm_id on insert). is_default changes only through
--    set_default_template; firm_id can never be changed. The seeding trigger
--    is security definer, so it still inserts the default template.
-- 3. set_default_template locks the firm's templates FOR NO KEY UPDATE (it
--    never changes a key, so FK checks from invoices are not blocked).

-- ---------------------------------------------------------------------------
-- 1. Consultant selection on drafts
-- ---------------------------------------------------------------------------
alter table public.invoices add column consultant_filter uuid[];

create or replace function public.create_invoice_draft(
  p_firm uuid, p_client uuid, p_start date, p_end date, p_template uuid, p_consultants uuid[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_firm public.firms%rowtype;
  v_id uuid;
begin
  if not public.has_role(p_firm, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select * into v_firm from public.firms f where f.id = p_firm;

  insert into public.invoices
    (firm_id, client_id, template_id, period_start, period_end,
     issue_date, due_date, currency, tax_percent, consultant_filter)
  values
    (p_firm, p_client, p_template, p_start, p_end,
     current_date, current_date + v_firm.default_payment_terms_days,
     v_firm.currency, v_firm.default_tax_percent, p_consultants)
  returning id into v_id;

  perform public.invoice_generate_time_lines(v_id, p_consultants);
  perform public.invoice_recalc(v_id);
  return v_id;
end;
$$;

revoke execute on function public.create_invoice_draft(uuid, uuid, date, date, uuid, uuid[])
  from public, anon;
grant execute on function public.create_invoice_draft(uuid, uuid, date, date, uuid, uuid[])
  to authenticated;

create or replace function public.regenerate_invoice_lines(p_invoice uuid, p_consultants uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.invoice_lock_draft(p_invoice);

  update public.invoices i
  set consultant_filter = p_consultants
  where i.id = p_invoice
    and i.consultant_filter is distinct from p_consultants;

  perform public.invoice_generate_time_lines(p_invoice, p_consultants);
  perform public.invoice_recalc(p_invoice);
end;
$$;

revoke execute on function public.regenerate_invoice_lines(uuid, uuid[]) from public, anon;
grant execute on function public.regenerate_invoice_lines(uuid, uuid[]) to authenticated;

create or replace function public.update_invoice_period(
  p_invoice uuid, p_start date, p_end date, p_consultants uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.invoice_lock_draft(p_invoice);

  update public.invoices i
  set period_start = p_start, period_end = p_end, consultant_filter = p_consultants
  where i.id = p_invoice;

  perform public.invoice_generate_time_lines(p_invoice, p_consultants);
  perform public.invoice_recalc(p_invoice);
end;
$$;

revoke execute on function public.update_invoice_period(uuid, date, date, uuid[]) from public, anon;
grant execute on function public.update_invoice_period(uuid, date, date, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Template column grants
-- ---------------------------------------------------------------------------
revoke insert, update on public.invoice_templates from authenticated;
grant insert (firm_id, name, base_layout, options) on public.invoice_templates to authenticated;
grant update (name, base_layout, options) on public.invoice_templates to authenticated;

-- ---------------------------------------------------------------------------
-- 3. set_default_template: FOR NO KEY UPDATE
-- ---------------------------------------------------------------------------
create or replace function public.set_default_template(p_template uuid)
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

  -- Lock the firm's templates so concurrent calls serialize. No key changes,
  -- so FOR NO KEY UPDATE (invoice FK checks still proceed).
  perform 1 from public.invoice_templates t
  where t.firm_id = v_firm
  order by t.id
  for no key update;

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
