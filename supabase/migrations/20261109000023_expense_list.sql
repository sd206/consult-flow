-- One page of the expense list, filtered exactly like expense_totals, so the
-- rows always agree with the total and count shown above them.
-- Admin/manager only (42501). Amount is returned as text.
create function public.list_expenses(
  p_firm uuid,
  p_from date,
  p_to date,
  p_category uuid,
  p_client uuid,
  p_project uuid,
  p_missing_receipt boolean,
  p_limit integer,
  p_offset integer
)
returns table (
  id uuid,
  spent_on date,
  category_id uuid,
  category_name text,
  payee text,
  amount text,
  client_id uuid,
  client_name text,
  project_id uuid,
  project_name text,
  receipt_count integer
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
  select e.id,
         e.spent_on,
         e.category_id,
         c.name,
         e.payee,
         e.amount::text,
         e.client_id,
         cl.name,
         e.project_id,
         pr.name,
         (select count(*)::integer from public.attachments a
          where a.firm_id = e.firm_id and a.expense_id = e.id)
  from public.expenses e
  join public.expense_categories c on c.firm_id = e.firm_id and c.id = e.category_id
  left join public.clients cl on cl.firm_id = e.firm_id and cl.id = e.client_id
  left join public.projects pr on pr.firm_id = e.firm_id and pr.id = e.project_id
  where e.firm_id = p_firm
    and (p_from is null or e.spent_on >= p_from)
    and (p_to is null or e.spent_on <= p_to)
    and (p_category is null or e.category_id = p_category)
    and (p_client is null or e.client_id = p_client)
    and (p_project is null or e.project_id = p_project)
    and (
      p_missing_receipt is not true
      or not exists (
        select 1 from public.attachments a
        where a.firm_id = e.firm_id and a.expense_id = e.id
      )
    )
  order by e.spent_on desc, e.created_at desc, e.id
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end;
$$;

revoke execute on function public.list_expenses(uuid, date, date, uuid, uuid, uuid, boolean, integer, integer)
  from public, anon;
grant execute on function public.list_expenses(uuid, date, date, uuid, uuid, uuid, boolean, integer, integer)
  to authenticated;
