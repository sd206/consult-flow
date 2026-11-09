-- Issue and void invoices; record the PDF path.
--
-- issue_invoice assigns the legal number under the firm row lock, freezes
-- the bill-to / from details, and links every time line to the exact
-- approved entries it stands for so the same hours can never be billed
-- twice. Lock order everywhere: invoice row, then firm row, then entries.
-- Any raise rolls back the whole call (nothing linked, no number consumed).

-- ---------------------------------------------------------------------------
-- Issue a draft. Returns the invoice number.
-- ---------------------------------------------------------------------------
create function public.issue_invoice(p_invoice uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_firm public.firms%rowtype;
  v_client public.clients%rowtype;
  v_line record;
  v_ids uuid[];
  v_hours numeric;
  v_number text;
begin
  v_inv := public.invoice_lock_draft(p_invoice);

  if not exists (
    select 1 from public.invoice_lines l
    where l.firm_id = v_inv.firm_id and l.invoice_id = v_inv.id
  ) then
    raise exception 'INVOICE_EMPTY' using errcode = 'P0001';
  end if;

  -- Serialises numbering (and, with it, entry claiming) per firm.
  select * into v_firm from public.firms f where f.id = v_inv.firm_id for update;

  for v_line in
    select l.id, l.consultant_id, l.project_id, l.unit_price, l.quantity
    from public.invoice_lines l
    where l.firm_id = v_inv.firm_id and l.invoice_id = v_inv.id and l.kind = 'time'
    order by l.sort_order, l.id
  loop
    with m as (
      select te.id, te.hours
      from public.time_entries te
      join public.timesheets ts on ts.firm_id = te.firm_id and ts.id = te.timesheet_id
      join public.projects p on p.firm_id = te.firm_id and p.id = te.project_id
      where te.firm_id = v_inv.firm_id
        and ts.status = 'approved'
        and te.invoice_line_id is null
        and ts.consultant_id = v_line.consultant_id
        and te.project_id = v_line.project_id
        and p.client_id = v_inv.client_id
        and te.client_rate_snapshot = v_line.unit_price
        and te.work_date between v_inv.period_start and v_inv.period_end
      order by te.id
      for update of te
    )
    select array_agg(m.id), coalesce(sum(m.hours), 0) into v_ids, v_hours from m;

    if v_hours <> v_line.quantity then
      raise exception 'INVOICE_STALE' using errcode = 'P0001';
    end if;

    update public.time_entries te
    set invoice_line_id = v_line.id
    where te.firm_id = v_inv.firm_id and te.id = any (v_ids);
  end loop;

  perform public.invoice_recalc(v_inv.id);

  v_number := public.format_invoice_number(
    v_firm.invoice_number_pattern, v_firm.invoice_next_seq, v_inv.issue_date
  );

  update public.firms f
  set invoice_next_seq = f.invoice_next_seq + 1
  where f.id = v_firm.id;

  select * into v_client from public.clients c
  where c.firm_id = v_inv.firm_id and c.id = v_inv.client_id;

  update public.invoices i
  set status = 'issued',
      number = v_number,
      issued_at = now(),
      issued_by = auth.uid(),
      currency = v_firm.currency,
      bill_to_name = v_client.name,
      bill_to_contact_name = v_client.billing_contact_name,
      bill_to_email = v_client.billing_email,
      bill_to_phone = v_client.billing_phone,
      bill_to_address = v_client.billing_address,
      from_name = v_firm.name,
      from_address = v_firm.address,
      from_contact_name = v_firm.contact_name,
      from_contact_email = v_firm.contact_email,
      from_contact_phone = v_firm.contact_phone,
      from_logo_path = v_firm.logo_path
  where i.id = v_inv.id;

  return v_number;
end;
$$;

revoke execute on function public.issue_invoice(uuid) from public, anon;
grant execute on function public.issue_invoice(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Void an issued invoice with no payments. Unlinks its entries so the hours
-- can be invoiced again. The number stays; the sequence is not rewound.
-- ---------------------------------------------------------------------------
create function public.void_invoice(p_invoice uuid)
returns void
language plpgsql
volatile
security definer
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

  if v_inv.status <> 'issued' then
    raise exception 'INVOICE_STATE' using errcode = 'P0001';
  end if;

  if v_inv.amount_paid > 0 then
    raise exception 'INVOICE_HAS_PAYMENTS' using errcode = 'P0001';
  end if;

  update public.time_entries te
  set invoice_line_id = null
  where te.firm_id = v_inv.firm_id
    and te.invoice_line_id in (
      select l.id from public.invoice_lines l
      where l.firm_id = v_inv.firm_id and l.invoice_id = v_inv.id
    );

  update public.invoices i
  set status = 'void', voided_at = now(), voided_by = auth.uid()
  where i.id = v_inv.id;
end;
$$;

revoke execute on function public.void_invoice(uuid) from public, anon;
grant execute on function public.void_invoice(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Record the stored PDF of an issued (or paid) invoice. The folder is
-- enforced by invoices_pdf_path_chk.
-- ---------------------------------------------------------------------------
create function public.set_invoice_pdf(p_invoice uuid, p_path text)
returns void
language plpgsql
volatile
security definer
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

  if v_inv.status not in ('issued', 'partly_paid', 'paid') then
    raise exception 'INVOICE_STATE' using errcode = 'P0001';
  end if;

  update public.invoices i set pdf_path = p_path where i.id = v_inv.id;
end;
$$;

revoke execute on function public.set_invoice_pdf(uuid, text) from public, anon;
grant execute on function public.set_invoice_pdf(uuid, text) to authenticated;
