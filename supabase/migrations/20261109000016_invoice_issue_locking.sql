-- Review fix: issue_invoice also locks the timesheets it reads
-- status = 'approved' from, closing a race with reopen_timesheet (which could
-- otherwise pass its TIMESHEET_INVOICED check before issue committed its
-- links, then null the rate snapshots of linked entries).
--
-- Lock order in issue_invoice: invoice row (FOR UPDATE) -> firm row (FOR NO
-- KEY UPDATE) -> timesheet rows (FOR SHARE, id order) -> time entry rows
-- (FOR UPDATE). reopen_timesheet / approve_timesheet: timesheet row (FOR
-- UPDATE) -> entries, plus FOR KEY SHARE on the firm from FK checks (audit
-- rows), which FOR NO KEY UPDATE does not block. Timesheets before entries in
-- both, and nothing waits on the firm in the reverse direction, so the two
-- cannot deadlock.

create or replace function public.issue_invoice(p_invoice uuid)
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
  v_ts_ids uuid[];
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

  -- Serialises numbering (and, with it, entry claiming) per firm. FOR NO KEY
  -- UPDATE, not FOR UPDATE: it still excludes other issuers but lets FK
  -- checks (FOR KEY SHARE on the firm, e.g. audit_log inserts from a
  -- concurrent reopen_timesheet that already holds a timesheet) proceed;
  -- FOR UPDATE there deadlocks against the timesheet lock below.
  select * into v_firm from public.firms f where f.id = v_inv.firm_id for no key update;

  -- Share-lock every approved timesheet holding candidate entries, in id
  -- order, before touching entries. reopen_timesheet / approve_timesheet take
  -- the timesheet row FOR UPDATE first, so they wait for this issue to commit
  -- (and then see the links), or this waits for them (and the status filter
  -- is re-checked). Only entries of these locked timesheets may match below;
  -- anything else makes the line STALE rather than being claimed unlocked.
  select array_agg(s.id) into v_ts_ids
  from (
    select ts.id
    from public.timesheets ts
    where ts.firm_id = v_inv.firm_id
      and ts.status = 'approved'
      and exists (
        select 1
        from public.time_entries te
        join public.projects p on p.firm_id = te.firm_id and p.id = te.project_id
        join public.invoice_lines l
          on l.firm_id = te.firm_id and l.invoice_id = v_inv.id and l.kind = 'time'
         and l.consultant_id = ts.consultant_id and l.project_id = te.project_id
        where te.firm_id = ts.firm_id
          and te.timesheet_id = ts.id
          and te.invoice_line_id is null
          and p.client_id = v_inv.client_id
          and te.work_date between v_inv.period_start and v_inv.period_end
      )
    order by ts.id
    for share of ts
  ) s;

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
        and ts.id = any (v_ts_ids)
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
