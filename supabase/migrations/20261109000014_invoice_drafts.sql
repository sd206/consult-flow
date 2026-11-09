-- Draft invoices: build time lines from approved, uninvoiced hours; manual
-- lines; one invoice-level discount; exact totals. All money arithmetic is
-- numeric and happens here.
--
-- Every function on an existing invoice locks it (for update), raises
-- INVOICE_NOT_FOUND when missing, then requires admin/manager (42501), then
-- status = 'draft' (INVOICE_STATE). Drafts never touch
-- time_entries.invoice_line_id; linking happens at issue (Task 4).
--
-- p_consultants: null = all consultants, empty array = none.

-- ---------------------------------------------------------------------------
-- Internal: candidate groups (consultant x project x frozen client rate) of
-- approved, uninvoiced entries on the client's projects within the period.
-- notes = distinct non-empty task notes in date order, joined with '; '.
-- ---------------------------------------------------------------------------
create function public.invoice_time_groups(
  p_firm uuid, p_client uuid, p_start date, p_end date, p_consultants uuid[]
)
returns table (
  consultant_id uuid,
  consultant_name text,
  project_id uuid,
  project_name text,
  rate numeric,
  hours numeric,
  entry_count integer,
  notes text
)
language sql
stable
set search_path = ''
as $$
  with e as (
    select ts.consultant_id, te.project_id, te.client_rate_snapshot as rate,
           te.hours, te.work_date, nullif(btrim(te.note), '') as note
    from public.time_entries te
    join public.timesheets ts on ts.firm_id = te.firm_id and ts.id = te.timesheet_id
    join public.projects p on p.firm_id = te.firm_id and p.id = te.project_id
    where te.firm_id = p_firm
      and p.client_id = p_client
      and ts.status = 'approved'
      and te.invoice_line_id is null
      and te.work_date between p_start and p_end
      and (p_consultants is null or ts.consultant_id = any (p_consultants))
  ),
  g as (
    select e.consultant_id, e.project_id, e.rate,
           sum(e.hours) as hours, count(*)::integer as entry_count
    from e
    group by e.consultant_id, e.project_id, e.rate
  ),
  n as (
    select e.consultant_id, e.project_id, e.rate, e.note, min(e.work_date) as first_date
    from e
    where e.note is not null
    group by e.consultant_id, e.project_id, e.rate, e.note
  ),
  nn as (
    select n.consultant_id, n.project_id, n.rate,
           string_agg(n.note, '; ' order by n.first_date, n.note) as notes
    from n
    group by n.consultant_id, n.project_id, n.rate
  )
  select g.consultant_id, c.name, g.project_id, p.name, g.rate, g.hours, g.entry_count, nn.notes
  from g
  join public.consultants c on c.firm_id = p_firm and c.id = g.consultant_id
  join public.projects p on p.firm_id = p_firm and p.id = g.project_id
  left join nn
    on nn.consultant_id = g.consultant_id and nn.project_id = g.project_id and nn.rate = g.rate
  order by c.name, p.name, g.rate, g.consultant_id, g.project_id
$$;

revoke execute on function public.invoice_time_groups(uuid, uuid, date, date, uuid[])
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Candidates for a new invoice. Admins/managers only.
-- ---------------------------------------------------------------------------
create function public.invoice_candidates(p_firm uuid, p_client uuid, p_start date, p_end date)
returns table (
  consultant_id uuid,
  consultant_name text,
  project_id uuid,
  project_name text,
  rate text,
  hours text,
  entry_count integer
)
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
  select g.consultant_id, g.consultant_name, g.project_id, g.project_name,
         g.rate::text, g.hours::text, g.entry_count
  from public.invoice_time_groups(p_firm, p_client, p_start, p_end, null) g
  order by g.consultant_name, g.project_name, g.rate, g.consultant_id, g.project_id;
end;
$$;

revoke execute on function public.invoice_candidates(uuid, uuid, date, date) from public, anon;
grant execute on function public.invoice_candidates(uuid, uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Internal: lock an invoice for editing (NOT_FOUND, then role, then draft).
-- ---------------------------------------------------------------------------
create function public.invoice_lock_draft(p_invoice uuid)
returns public.invoices
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
begin
  select * into v_inv from public.invoices i where i.id = p_invoice for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.has_role(v_inv.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_inv.status <> 'draft' then
    raise exception 'INVOICE_STATE' using errcode = 'P0001';
  end if;

  return v_inv;
end;
$$;

revoke execute on function public.invoice_lock_draft(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal: recompute subtotal, discount, tax and total. A fixed discount is
-- capped at the subtotal here (never an error).
-- ---------------------------------------------------------------------------
create function public.invoice_recalc(p_invoice uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_sub numeric;
  v_disc numeric;
  v_tax numeric;
begin
  select * into v_inv from public.invoices i where i.id = p_invoice;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(sum(l.amount), 0) into v_sub
  from public.invoice_lines l
  where l.firm_id = v_inv.firm_id and l.invoice_id = v_inv.id;

  v_disc := case v_inv.discount_type
    when 'percent' then round(v_sub * v_inv.discount_value / 100, 2)
    when 'amount' then least(v_inv.discount_value, v_sub)
    else 0
  end;
  v_tax := round((v_sub - v_disc) * v_inv.tax_percent / 100, 2);

  update public.invoices i
  set subtotal = v_sub,
      discount_amount = v_disc,
      tax_amount = v_tax,
      total = v_sub - v_disc + v_tax
  where i.id = v_inv.id
    and (i.subtotal, i.discount_amount, i.tax_amount, i.total)
        is distinct from (v_sub, v_disc, v_tax, v_sub - v_disc + v_tax);
end;
$$;

revoke execute on function public.invoice_recalc(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal: replace the invoice's time lines from its client and period.
-- Time lines are numbered 1..n in candidate order; manual lines keep their
-- relative order and are renumbered to follow.
-- ---------------------------------------------------------------------------
create function public.invoice_generate_time_lines(p_invoice uuid, p_consultants uuid[])
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_n integer;
begin
  select * into v_inv from public.invoices i where i.id = p_invoice;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;

  delete from public.invoice_lines l
  where l.firm_id = v_inv.firm_id and l.invoice_id = v_inv.id and l.kind = 'time';

  insert into public.invoice_lines
    (firm_id, invoice_id, kind, consultant_id, project_id, description,
     quantity, unit_price, amount, sort_order)
  select v_inv.firm_id, v_inv.id, 'time'::public.invoice_line_kind, g.consultant_id, g.project_id,
         coalesce(left(g.notes, 500), g.project_name),
         g.hours, g.rate, round(g.hours * g.rate, 2),
         row_number() over (
           order by g.consultant_name, g.project_name, g.rate, g.consultant_id, g.project_id
         )
  from public.invoice_time_groups(
    v_inv.firm_id, v_inv.client_id, v_inv.period_start, v_inv.period_end, p_consultants
  ) g;
  get diagnostics v_n = row_count;

  update public.invoice_lines l
  set sort_order = v_n + r.rn
  from (
    select m.id, row_number() over (order by m.sort_order, m.created_at, m.id) as rn
    from public.invoice_lines m
    where m.firm_id = v_inv.firm_id and m.invoice_id = v_inv.id and m.kind = 'manual'
  ) r
  where l.id = r.id and l.sort_order <> v_n + r.rn;
end;
$$;

revoke execute on function public.invoice_generate_time_lines(uuid, uuid[])
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Create a draft. Admins/managers only. A draft with zero lines is allowed.
-- ---------------------------------------------------------------------------
create function public.create_invoice_draft(
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
     issue_date, due_date, currency, tax_percent)
  values
    (p_firm, p_client, p_template, p_start, p_end,
     current_date, current_date + v_firm.default_payment_terms_days,
     v_firm.currency, v_firm.default_tax_percent)
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

-- ---------------------------------------------------------------------------
-- Regenerate time lines for the invoice's own client and period.
-- ---------------------------------------------------------------------------
create function public.regenerate_invoice_lines(p_invoice uuid, p_consultants uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.invoice_lock_draft(p_invoice);
  perform public.invoice_generate_time_lines(p_invoice, p_consultants);
  perform public.invoice_recalc(p_invoice);
end;
$$;

revoke execute on function public.regenerate_invoice_lines(uuid, uuid[]) from public, anon;
grant execute on function public.regenerate_invoice_lines(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Header fields. The template must be in the same firm (composite FK).
-- ---------------------------------------------------------------------------
create function public.update_invoice_draft(
  p_invoice uuid, p_subject text, p_issue_date date, p_due_date date,
  p_tax_percent numeric, p_template uuid
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
  set subject = nullif(btrim(p_subject), ''),
      issue_date = p_issue_date,
      due_date = p_due_date,
      tax_percent = p_tax_percent,
      template_id = p_template
  where i.id = p_invoice;

  perform public.invoice_recalc(p_invoice);
end;
$$;

revoke execute on function public.update_invoice_draft(uuid, text, date, date, numeric, uuid)
  from public, anon;
grant execute on function public.update_invoice_draft(uuid, text, date, date, numeric, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Change the period, then regenerate time lines.
-- ---------------------------------------------------------------------------
create function public.update_invoice_period(
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
  set period_start = p_start, period_end = p_end
  where i.id = p_invoice;

  perform public.invoice_generate_time_lines(p_invoice, p_consultants);
  perform public.invoice_recalc(p_invoice);
end;
$$;

revoke execute on function public.update_invoice_period(uuid, date, date, uuid[]) from public, anon;
grant execute on function public.update_invoice_period(uuid, date, date, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Edit any line's description on a draft. A missing line reports
-- INVOICE_NOT_FOUND (there is no separate line code).
-- ---------------------------------------------------------------------------
create function public.set_invoice_line_description(p_line uuid, p_description text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invoice uuid;
begin
  select l.invoice_id into v_invoice from public.invoice_lines l where l.id = p_line;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform public.invoice_lock_draft(v_invoice);

  update public.invoice_lines l
  set description = coalesce(btrim(p_description), '')
  where l.id = p_line and l.invoice_id = v_invoice;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.set_invoice_line_description(uuid, text) from public, anon;
grant execute on function public.set_invoice_line_description(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Insert (p_line null) or update a manual line. Inputs are rounded to the
-- column scale first so amount = round(quantity * unit_price, 2) holds for
-- the stored values.
-- ---------------------------------------------------------------------------
create function public.save_manual_line(
  p_invoice uuid, p_line uuid, p_description text, p_quantity numeric, p_unit_price numeric
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_kind public.invoice_line_kind;
  v_qty numeric := round(p_quantity, 2);
  v_price numeric := round(p_unit_price, 2);
  v_id uuid;
begin
  v_inv := public.invoice_lock_draft(p_invoice);

  if p_line is null then
    insert into public.invoice_lines
      (firm_id, invoice_id, kind, description, quantity, unit_price, amount, sort_order)
    values
      (v_inv.firm_id, v_inv.id, 'manual', coalesce(btrim(p_description), ''),
       v_qty, v_price, round(v_qty * v_price, 2),
       (select coalesce(max(l.sort_order), 0) + 1 from public.invoice_lines l
        where l.firm_id = v_inv.firm_id and l.invoice_id = v_inv.id))
    returning id into v_id;
  else
    select l.kind into v_kind
    from public.invoice_lines l
    where l.id = p_line and l.firm_id = v_inv.firm_id and l.invoice_id = v_inv.id;
    if not found then
      raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_kind <> 'manual' then
      raise exception 'LINE_NOT_MANUAL' using errcode = 'P0001';
    end if;

    update public.invoice_lines l
    set description = coalesce(btrim(p_description), ''),
        quantity = v_qty,
        unit_price = v_price,
        amount = round(v_qty * v_price, 2)
    where l.id = p_line
    returning l.id into v_id;
  end if;

  perform public.invoice_recalc(v_inv.id);
  return v_id;
end;
$$;

revoke execute on function public.save_manual_line(uuid, uuid, text, numeric, numeric)
  from public, anon;
grant execute on function public.save_manual_line(uuid, uuid, text, numeric, numeric)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Delete a manual line.
-- ---------------------------------------------------------------------------
create function public.delete_manual_line(p_line uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invoice uuid;
  v_kind public.invoice_line_kind;
begin
  select l.invoice_id into v_invoice from public.invoice_lines l where l.id = p_line;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform public.invoice_lock_draft(v_invoice);

  select l.kind into v_kind from public.invoice_lines l
  where l.id = p_line and l.invoice_id = v_invoice;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_kind <> 'manual' then
    raise exception 'LINE_NOT_MANUAL' using errcode = 'P0001';
  end if;

  delete from public.invoice_lines l where l.id = p_line;
  perform public.invoice_recalc(v_invoice);
end;
$$;

revoke execute on function public.delete_manual_line(uuid) from public, anon;
grant execute on function public.delete_manual_line(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Set the invoice-level discount. 'none' forces value 0 and no label; the
-- label is trimmed (empty -> null) and cut to 60 characters. A fixed amount
-- above the current subtotal raises DISCOUNT_TOO_LARGE; percentages are
-- checked by invoices_discount_chk.
-- ---------------------------------------------------------------------------
create function public.set_invoice_discount(
  p_invoice uuid, p_type public.invoice_discount_type, p_value numeric, p_label text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_sub numeric;
begin
  v_inv := public.invoice_lock_draft(p_invoice);

  if p_type = 'amount' then
    select coalesce(sum(l.amount), 0) into v_sub
    from public.invoice_lines l
    where l.firm_id = v_inv.firm_id and l.invoice_id = v_inv.id;
    if p_value > v_sub then
      raise exception 'DISCOUNT_TOO_LARGE' using errcode = 'P0001';
    end if;
  end if;

  update public.invoices i
  set discount_type = p_type,
      discount_value = case when p_type = 'none' then 0 else p_value end,
      discount_label = case when p_type = 'none' then null
                            else left(nullif(btrim(p_label), ''), 60) end
  where i.id = v_inv.id;

  perform public.invoice_recalc(v_inv.id);
end;
$$;

revoke execute on function public.set_invoice_discount(uuid, public.invoice_discount_type, numeric, text)
  from public, anon;
grant execute on function public.set_invoice_discount(uuid, public.invoice_discount_type, numeric, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Delete a draft (lines cascade).
-- ---------------------------------------------------------------------------
create function public.delete_invoice_draft(p_invoice uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.invoice_lock_draft(p_invoice);
  delete from public.invoices i where i.id = p_invoice;
end;
$$;

revoke execute on function public.delete_invoice_draft(uuid) from public, anon;
grant execute on function public.delete_invoice_draft(uuid) to authenticated;
