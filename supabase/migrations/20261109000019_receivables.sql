-- Receivables: unpaid invoices, ageing buckets and the outstanding summary.
-- Admins and managers of the firm only. Days overdue = current_date - due_date;
-- bucket boundaries match bucketFor in src/lib/domain/ageing.ts.

create function public.unpaid_invoices(p_firm uuid, p_client uuid)
returns table (
  invoice_id uuid,
  number text,
  client_id uuid,
  client_name text,
  issue_date date,
  due_date date,
  total text,
  amount_paid text,
  balance_due text,
  days_overdue integer
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
  select i.id, i.number, i.client_id, c.name, i.issue_date, i.due_date,
         i.total::numeric(12, 2)::text,
         i.amount_paid::numeric(12, 2)::text,
         (i.total - i.amount_paid)::numeric(12, 2)::text,
         (current_date - i.due_date)::integer
  from public.invoices i
  join public.clients c on c.firm_id = i.firm_id and c.id = i.client_id
  where i.firm_id = p_firm
    and i.status in ('issued', 'partly_paid')
    and (p_client is null or i.client_id = p_client)
  order by i.due_date, i.number;
end;
$$;

revoke execute on function public.unpaid_invoices(uuid, uuid) from public, anon;
grant execute on function public.unpaid_invoices(uuid, uuid) to authenticated;

create function public.unpaid_ageing(p_firm uuid, p_client uuid)
returns table (bucket text, balance_due text, invoice_count integer)
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
  with b(bucket, ord) as (
    values ('current', 1), ('d1_30', 2), ('d31_60', 3), ('d61_90', 4), ('d90_plus', 5)
  ),
  inv as (
    select (i.total - i.amount_paid) as bal,
           case
             when current_date - i.due_date <= 0 then 'current'
             when current_date - i.due_date <= 30 then 'd1_30'
             when current_date - i.due_date <= 60 then 'd31_60'
             when current_date - i.due_date <= 90 then 'd61_90'
             else 'd90_plus'
           end as bucket
    from public.invoices i
    where i.firm_id = p_firm
      and i.status in ('issued', 'partly_paid')
      and (p_client is null or i.client_id = p_client)
  )
  select b.bucket,
         coalesce(sum(inv.bal), 0)::numeric(12, 2)::text,
         count(inv.bal)::integer
  from b
  left join inv on inv.bucket = b.bucket
  group by b.bucket, b.ord
  order by b.ord;
end;
$$;

revoke execute on function public.unpaid_ageing(uuid, uuid) from public, anon;
grant execute on function public.unpaid_ageing(uuid, uuid) to authenticated;

create function public.outstanding_summary(p_firm uuid)
returns table (outstanding text, overdue text, overdue_count integer)
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
  select coalesce(sum(i.total - i.amount_paid), 0)::numeric(12, 2)::text,
         coalesce(sum(i.total - i.amount_paid) filter (where current_date > i.due_date), 0)::numeric(12, 2)::text,
         (count(*) filter (where current_date > i.due_date))::integer
  from public.invoices i
  where i.firm_id = p_firm and i.status in ('issued', 'partly_paid');
end;
$$;

revoke execute on function public.outstanding_summary(uuid) from public, anon;
grant execute on function public.outstanding_summary(uuid) to authenticated;
