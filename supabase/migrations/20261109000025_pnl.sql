-- P&L reporting. All money arithmetic for the report lives here.
--
-- pnl_facts: one row per measured amount, each dated by its own date
--   revenue_hours  hours x client_rate_snapshot, approved timesheets, by work_date
--   labour         hours x cost_rate_snapshot, same entries
--   revenue_fees   manual invoice lines on issued/partly_paid/paid invoices, by issue_date
--   discount       discount_amount of those invoices, by issue_date
--   invoiced       subtotal - discount_amount of those invoices, by issue_date
--   collected      per payment on a non-void invoice with total > 0:
--                  round(amount x (total - tax_amount) / total, 2), by paid_on
--   direct_expense expenses with a client or a project, by spent_on
--   overhead       expenses with neither, by spent_on
-- Amounts are exact (no rounding) except collected, which is rounded per payment.
--
-- pnl_report: groups the facts by month, quarter, client or project and
-- formats every money column as numeric(14,2) text. Measures are summed
-- exactly per row and rounded once; revenue, gross and net are derived from
-- the row's rounded measures (so the columns foot); margin is computed from
-- the exact sums and rounded to 1 dp (null when revenue is 0.00). The total
-- row is computed from the facts, not from the rounded rows.
--
-- Admins and managers of the firm only (42501).

create function public.pnl_facts(p_firm uuid, p_from date, p_to date)
returns table (fact_date date, client_id uuid, project_id uuid, measure text, amount numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.has_role(p_firm, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  return query
  with hours as (
    select te.work_date, p.client_id, te.project_id, te.hours,
           te.client_rate_snapshot, te.cost_rate_snapshot
    from public.time_entries te
    join public.timesheets ts on ts.firm_id = te.firm_id and ts.id = te.timesheet_id
    join public.projects p on p.firm_id = te.firm_id and p.id = te.project_id
    where te.firm_id = p_firm
      and ts.status = 'approved'
      and te.work_date between p_from and p_to
  ),
  inv as (
    select i.id, i.issue_date, i.client_id, i.subtotal, i.discount_amount
    from public.invoices i
    where i.firm_id = p_firm
      and i.status in ('issued', 'partly_paid', 'paid')
      and i.issue_date between p_from and p_to
  )
  select h.work_date, h.client_id, h.project_id, 'revenue_hours'::text,
         h.hours * h.client_rate_snapshot
  from hours h
  union all
  select h.work_date, h.client_id, h.project_id, 'labour'::text,
         h.hours * h.cost_rate_snapshot
  from hours h
  union all
  select inv.issue_date, inv.client_id, null::uuid, 'revenue_fees'::text, l.amount
  from inv
  join public.invoice_lines l on l.firm_id = p_firm and l.invoice_id = inv.id
  where l.kind = 'manual'
  union all
  select inv.issue_date, inv.client_id, null::uuid, 'discount'::text, inv.discount_amount::numeric
  from inv
  union all
  select inv.issue_date, inv.client_id, null::uuid, 'invoiced'::text,
         (inv.subtotal - inv.discount_amount)::numeric
  from inv
  union all
  select pay.paid_on, i.client_id, null::uuid, 'collected'::text,
         round(pay.amount * (i.total - i.tax_amount) / i.total, 2)
  from public.payments pay
  join public.invoices i on i.firm_id = pay.firm_id and i.id = pay.invoice_id
  where pay.firm_id = p_firm
    and i.status <> 'void'
    and i.total > 0
    and pay.paid_on between p_from and p_to
  union all
  select e.spent_on, e.client_id, e.project_id,
         case when e.client_id is null and e.project_id is null
              then 'overhead' else 'direct_expense' end::text,
         e.amount::numeric
  from public.expenses e
  where e.firm_id = p_firm
    and e.spent_on between p_from and p_to;
end;
$$;

revoke execute on function public.pnl_facts(uuid, date, date) from public, anon;
grant execute on function public.pnl_facts(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- The report. p_group: month | quarter | client | project.
-- p_clients / p_projects: null = all; a fact is kept when its client (and
-- project) is in the list. A project filter drops facts with no project.
-- With any filter, overhead is 0 and the overhead row is omitted.
-- group_key: period start (YYYY-MM-01), client id, project id, or
-- client:{id} for a client's no-project row; 'overhead' and 'total' for the
-- two summary rows. sort_key: YYYY-MM for months, YYYY-Q# for quarters, a
-- zero-padded ordinal for clients/projects, null for the summary rows.
-- ---------------------------------------------------------------------------
create function public.pnl_report(
  p_firm uuid,
  p_from date,
  p_to date,
  p_group text,
  p_clients uuid[],
  p_projects uuid[]
)
returns table (
  row_kind text,
  group_key text,
  label text,
  sort_key text,
  revenue_hours text,
  fees text,
  discounts text,
  revenue text,
  labour text,
  gross text,
  direct_expenses text,
  overhead text,
  net text,
  margin text,
  invoiced text,
  collected text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_periodic boolean := p_group in ('month', 'quarter');
  v_unit text := case when p_group = 'quarter' then 'quarter' else 'month' end;
  v_step interval := case when p_group = 'quarter' then interval '3 months' else interval '1 month' end;
  v_unallocated boolean := p_group in ('client', 'project') and p_clients is null and p_projects is null;
begin
  if not public.has_role(p_firm, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if p_group is null or p_group not in ('month', 'quarter', 'client', 'project') then
    raise exception 'PNL_GROUP_INVALID' using errcode = 'P0001';
  end if;

  if p_from is null or p_to is null or p_to < p_from or p_to > p_from + interval '3 years' then
    raise exception 'PNL_RANGE_INVALID' using errcode = 'P0001';
  end if;

  return query
  with fk as (
    select x.measure, x.amount, x.client_id, x.project_id,
           case
             when v_periodic then to_char(date_trunc(v_unit, x.fact_date::timestamp), 'YYYY-MM-DD')
             when p_group = 'client' then x.client_id::text
             else coalesce(x.project_id::text, 'client:' || x.client_id::text)
           end as gkey
    from public.pnl_facts(p_firm, p_from, p_to) x
    where (p_clients is null or x.client_id = any (p_clients))
      and (p_projects is null or x.project_id = any (p_projects))
  ),
  periods as (
    select to_char(d, 'YYYY-MM-DD') as gkey,
           case when p_group = 'month' then to_char(d, 'Mon YYYY') else to_char(d, 'YYYY "Q"Q') end as label,
           case when p_group = 'month' then to_char(d, 'YYYY-MM') else to_char(d, 'YYYY-"Q"Q') end as sort_key
    from generate_series(date_trunc(v_unit, p_from::timestamp), p_to::timestamp, v_step) d
    where v_periodic
  ),
  -- Clients / projects with any fact; k1..k7 give the display order.
  named as (
    select c.id::text as gkey, c.name as label,
           lower(c.name) as k1, c.name as k2, c.id::text as k3,
           0 as k4, ''::text as k5, ''::text as k6, ''::text as k7
    from public.clients c
    where p_group = 'client'
      and c.firm_id = p_firm
      and exists (select 1 from fk where fk.client_id = c.id)
    union all
    select p.id::text, c.name || ' — ' || p.name,
           lower(c.name), c.name, c.id::text, 0, lower(p.name), p.name, p.id::text
    from public.projects p
    join public.clients c on c.firm_id = p.firm_id and c.id = p.client_id
    where p_group = 'project'
      and p.firm_id = p_firm
      and exists (select 1 from fk where fk.project_id = p.id)
    union all
    select 'client:' || c.id::text, c.name || ' — no project',
           lower(c.name), c.name, c.id::text, 1, '', '', ''
    from public.clients c
    where p_group = 'project'
      and c.firm_id = p_firm
      and exists (select 1 from fk where fk.project_id is null and fk.client_id = c.id)
  ),
  heads as (
    select 1 as kind_ord, periods.gkey, periods.label, periods.sort_key from periods
    union all
    select 1, n.gkey, n.label,
           lpad((row_number() over (order by n.k1, n.k2, n.k3, n.k4, n.k5, n.k6, n.k7))::text, 6, '0')
    from named n
    union all
    select 2, 'overhead', 'Unallocated overhead', null::text where v_unallocated
    union all
    select 3, 'total', 'Total', null::text
  ),
  keyed as (
    select 1 as kind_ord, fk.gkey, fk.measure, fk.amount from fk where fk.gkey is not null
    union all
    select 2, 'overhead', fk.measure, fk.amount from fk where fk.measure = 'overhead' and v_unallocated
    union all
    select 3, 'total', fk.measure, fk.amount from fk
  ),
  sums as (
    select h.kind_ord, h.gkey, h.label, h.sort_key,
           coalesce(sum(k.amount) filter (where k.measure = 'revenue_hours'), 0) as rh,
           coalesce(sum(k.amount) filter (where k.measure = 'revenue_fees'), 0) as fe,
           coalesce(sum(k.amount) filter (where k.measure = 'discount'), 0) as di,
           coalesce(sum(k.amount) filter (where k.measure = 'labour'), 0) as la,
           coalesce(sum(k.amount) filter (where k.measure = 'direct_expense'), 0) as de,
           coalesce(sum(k.amount) filter (where k.measure = 'overhead'), 0) as ov,
           coalesce(sum(k.amount) filter (where k.measure = 'invoiced'), 0) as iv,
           coalesce(sum(k.amount) filter (where k.measure = 'collected'), 0) as co
    from heads h
    left join keyed k on k.kind_ord = h.kind_ord and k.gkey = h.gkey
    group by h.kind_ord, h.gkey, h.label, h.sort_key
  ),
  r as (
    select s.*,
           round(s.rh, 2) as rh2, round(s.fe, 2) as fe2, round(s.di, 2) as di2,
           round(s.la, 2) as la2, round(s.de, 2) as de2, round(s.ov, 2) as ov2,
           round(s.iv, 2) as iv2, round(s.co, 2) as co2,
           s.rh + s.fe - s.di as rev_exact,
           s.rh + s.fe - s.di - s.la - s.de - s.ov as net_exact
    from sums s
  )
  select case r.kind_ord when 1 then 'group' when 2 then 'overhead' else 'total' end,
         r.gkey,
         r.label,
         r.sort_key,
         r.rh2::numeric(14, 2)::text,
         r.fe2::numeric(14, 2)::text,
         r.di2::numeric(14, 2)::text,
         (r.rh2 + r.fe2 - r.di2)::numeric(14, 2)::text,
         r.la2::numeric(14, 2)::text,
         (r.rh2 + r.fe2 - r.di2 - r.la2)::numeric(14, 2)::text,
         r.de2::numeric(14, 2)::text,
         r.ov2::numeric(14, 2)::text,
         (r.rh2 + r.fe2 - r.di2 - r.la2 - r.de2 - r.ov2)::numeric(14, 2)::text,
         case when round(r.rev_exact, 2) = 0 then null
              else round(r.net_exact / r.rev_exact * 100, 1)::text end,
         r.iv2::numeric(14, 2)::text,
         r.co2::numeric(14, 2)::text
  from r
  order by r.kind_ord, r.sort_key collate "C";
end;
$$;

revoke execute on function public.pnl_report(uuid, date, date, text, uuid[], uuid[]) from public, anon;
grant execute on function public.pnl_report(uuid, date, date, text, uuid[], uuid[]) to authenticated;
