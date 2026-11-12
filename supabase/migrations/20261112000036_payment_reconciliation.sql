-- Payments list: show which bank account (if any) a payment is reconciled to,
-- and filter by it. p_bank is 'all' (default), 'reconciled' or 'unreconciled';
-- a payment is reconciled when a bank line links to it. Totals use the same filter.
drop function public.list_payments(uuid, date, date, uuid, integer, integer);
drop function public.payment_totals(uuid, date, date, uuid);

create function public.list_payments(
  p_firm uuid,
  p_from date,
  p_to date,
  p_client uuid,
  p_limit integer,
  p_offset integer,
  p_bank text default 'all'
)
returns table (
  payment_id uuid,
  paid_on date,
  invoice_id uuid,
  invoice_number text,
  invoice_status text,
  client_id uuid,
  client_name text,
  method text,
  reference text,
  amount text,
  file_count integer,
  bank_account text
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
  if coalesce(p_bank, 'all') not in ('all', 'reconciled', 'unreconciled') then
    raise exception 'invalid bank filter' using errcode = '22023';
  end if;

  return query
  select p.id,
         p.paid_on,
         i.id,
         i.number,
         i.status::text,
         cl.id,
         cl.name,
         p.method::text,
         p.reference,
         p.amount::text,
         (select count(*)::integer from public.attachments a
          where a.firm_id = p.firm_id and a.payment_id = p.id),
         ba.name
  from public.payments p
  join public.invoices i on i.firm_id = p.firm_id and i.id = p.invoice_id
  join public.clients cl on cl.firm_id = i.firm_id and cl.id = i.client_id
  left join public.bank_lines bl on bl.payment_id = p.id
  left join public.bank_accounts ba on ba.firm_id = bl.firm_id and ba.id = bl.account_id
  where p.firm_id = p_firm
    and (p_from is null or p.paid_on >= p_from)
    and (p_to is null or p.paid_on <= p_to)
    and (p_client is null or i.client_id = p_client)
    and (coalesce(p_bank, 'all') = 'all'
         or (p_bank = 'reconciled' and bl.id is not null)
         or (p_bank = 'unreconciled' and bl.id is null))
  order by p.paid_on desc, p.created_at desc, p.id
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end;
$$;

create function public.payment_totals(
  p_firm uuid,
  p_from date,
  p_to date,
  p_client uuid,
  p_bank text default 'all'
)
returns table (total text, payment_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role(p_firm, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if coalesce(p_bank, 'all') not in ('all', 'reconciled', 'unreconciled') then
    raise exception 'invalid bank filter' using errcode = '22023';
  end if;

  return query
  select coalesce(sum(p.amount), 0)::numeric(12, 2)::text,
         count(*)::integer
  from public.payments p
  join public.invoices i on i.firm_id = p.firm_id and i.id = p.invoice_id
  where p.firm_id = p_firm
    and (p_from is null or p.paid_on >= p_from)
    and (p_to is null or p.paid_on <= p_to)
    and (p_client is null or i.client_id = p_client)
    and (coalesce(p_bank, 'all') = 'all'
         or (p_bank = 'reconciled') = exists (select 1 from public.bank_lines bl where bl.payment_id = p.id));
end;
$$;

revoke execute on function public.list_payments(uuid, date, date, uuid, integer, integer, text) from public, anon;
grant execute on function public.list_payments(uuid, date, date, uuid, integer, integer, text) to authenticated;
revoke execute on function public.payment_totals(uuid, date, date, uuid, text) from public, anon;
grant execute on function public.payment_totals(uuid, date, date, uuid, text) to authenticated;
