-- Every payment in a firm, with its invoice and client, filtered by payment date
-- and optionally client. payment_totals applies the same filters so the summary
-- always agrees with the rows. Admin/manager only (42501). Amounts are text.
create function public.list_payments(
  p_firm uuid,
  p_from date,
  p_to date,
  p_client uuid,
  p_limit integer,
  p_offset integer
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
  file_count integer
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
          where a.firm_id = p.firm_id and a.payment_id = p.id)
  from public.payments p
  join public.invoices i on i.firm_id = p.firm_id and i.id = p.invoice_id
  join public.clients cl on cl.firm_id = i.firm_id and cl.id = i.client_id
  where p.firm_id = p_firm
    and (p_from is null or p.paid_on >= p_from)
    and (p_to is null or p.paid_on <= p_to)
    and (p_client is null or i.client_id = p_client)
  order by p.paid_on desc, p.created_at desc, p.id
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end;
$$;

create function public.payment_totals(
  p_firm uuid,
  p_from date,
  p_to date,
  p_client uuid
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

  return query
  select coalesce(sum(p.amount), 0)::numeric(12, 2)::text,
         count(*)::integer
  from public.payments p
  join public.invoices i on i.firm_id = p.firm_id and i.id = p.invoice_id
  where p.firm_id = p_firm
    and (p_from is null or p.paid_on >= p_from)
    and (p_to is null or p.paid_on <= p_to)
    and (p_client is null or i.client_id = p_client);
end;
$$;

revoke execute on function public.list_payments(uuid, date, date, uuid, integer, integer)
  from public, anon;
grant execute on function public.list_payments(uuid, date, date, uuid, integer, integer)
  to authenticated;
revoke execute on function public.payment_totals(uuid, date, date, uuid)
  from public, anon;
grant execute on function public.payment_totals(uuid, date, date, uuid)
  to authenticated;
