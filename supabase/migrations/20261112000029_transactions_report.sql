-- Transactions report: every payment received and every expense in a date range,
-- oldest first, for the accountant's export. p_kind is 'all', 'in' (payments) or
-- 'out' (expenses). Amounts are unsigned text; the app applies the sign.
-- Admin/manager only (42501).
create function public.transactions_report(
  p_firm uuid,
  p_from date,
  p_to date,
  p_kind text
)
returns table (
  kind text,
  id uuid,
  txn_date date,
  client_name text,
  project_name text,
  invoice_number text,
  method text,
  reference text,
  payee text,
  category text,
  amount text,
  notes text
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
  if p_kind is null or p_kind not in ('all', 'in', 'out') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;

  return query
  select t.kind, t.id, t.txn_date, t.client_name, t.project_name, t.invoice_number,
         t.method, t.reference, t.payee, t.category, t.amount, t.notes
  from (
    select 'payment'::text as kind,
           p.id,
           p.paid_on as txn_date,
           cl.name as client_name,
           null::text as project_name,
           i.number as invoice_number,
           p.method::text as method,
           p.reference,
           null::text as payee,
           'Client payment'::text as category,
           p.amount::text as amount,
           p.notes,
           p.created_at
    from public.payments p
    join public.invoices i on i.firm_id = p.firm_id and i.id = p.invoice_id
    join public.clients cl on cl.firm_id = i.firm_id and cl.id = i.client_id
    where p.firm_id = p_firm
      and p_kind in ('all', 'in')
      and (p_from is null or p.paid_on >= p_from)
      and (p_to is null or p.paid_on <= p_to)
    union all
    select 'expense'::text,
           e.id,
           e.spent_on,
           cl.name,
           pr.name,
           null::text,
           null::text,
           null::text,
           e.payee,
           c.name,
           e.amount::text,
           e.notes,
           e.created_at
    from public.expenses e
    join public.expense_categories c on c.firm_id = e.firm_id and c.id = e.category_id
    left join public.clients cl on cl.firm_id = e.firm_id and cl.id = e.client_id
    left join public.projects pr on pr.firm_id = e.firm_id and pr.id = e.project_id
    where e.firm_id = p_firm
      and p_kind in ('all', 'out')
      and (p_from is null or e.spent_on >= p_from)
      and (p_to is null or e.spent_on <= p_to)
  ) t
  order by t.txn_date, t.created_at, t.id;
end;
$$;

revoke execute on function public.transactions_report(uuid, date, date, text)
  from public, anon;
grant execute on function public.transactions_report(uuid, date, date, text)
  to authenticated;
