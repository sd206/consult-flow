-- P&L breakdown columns.
--
-- 1. pnl_report gains two trailing columns, client_label and project_label.
--    They are filled only under project grouping (the client and project
--    names of each project / no-project row) and null everywhere else, so the
--    page and CSV can show Client and Project as separate columns without
--    splitting the combined label. Every other column and every number is
--    unchanged. The return type changes, so the function is dropped and
--    re-created (and re-granted).
--
-- 2. pnl_breakdown returns the detail rows under each pnl_report group row:
--      month / quarter: one row per period x client (x project when
--                       p_split_project), plus one 'Overhead' row per period
--                       for overhead facts (client_id null);
--      client:          one row per client x project (overhead is left to
--                       pnl_report's Unallocated overhead row).
--    A client fact with no project is labelled 'no project' (project_id null).
--    Only rows with at least one non-zero fact appear. Measures are summed
--    exactly per row and rounded once; revenue, gross and net come from the
--    rounded measures; margin is null when displayed revenue <= 0, otherwise
--    round(exact net / exact revenue x 100, 1) -- exactly as pnl_report.
--    Filters behave as in pnl_report (any filter drops overhead facts, a
--    project filter drops no-project facts). group_key matches pnl_report's
--    group_key (period start or client id); sort_key orders the rows within
--    and across groups.
--
-- Admins and managers of the firm only (42501).

drop function public.pnl_report(uuid, date, date, text, uuid[], uuid[]);

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
  collected text,
  client_label text,
  project_label text
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
    select c.id::text as gkey, c.name::text as label,
           lower(c.name) as k1, c.name as k2, c.id::text as k3,
           0 as k4, ''::text as k5, ''::text as k6, ''::text as k7,
           null::text as cl, null::text as pl
    from public.clients c
    where p_group = 'client'
      and c.firm_id = p_firm
      and exists (select 1 from fk where fk.client_id = c.id)
    union all
    select p.id::text, c.name || ' — ' || p.name,
           lower(c.name), c.name, c.id::text, 0, lower(p.name), p.name, p.id::text,
           c.name::text, p.name::text
    from public.projects p
    join public.clients c on c.firm_id = p.firm_id and c.id = p.client_id
    where p_group = 'project'
      and p.firm_id = p_firm
      and exists (select 1 from fk where fk.project_id = p.id)
    union all
    select 'client:' || c.id::text, c.name || ' — no project',
           lower(c.name), c.name, c.id::text, 1, '', '', '',
           c.name::text, 'no project'::text
    from public.clients c
    where p_group = 'project'
      and c.firm_id = p_firm
      and exists (select 1 from fk where fk.project_id is null and fk.client_id = c.id)
  ),
  heads as (
    select 1 as kind_ord, periods.gkey, periods.label, periods.sort_key,
           null::text as cl, null::text as pl
    from periods
    union all
    select 1, n.gkey, n.label,
           lpad((row_number() over (order by n.k1, n.k2, n.k3, n.k4, n.k5, n.k6, n.k7))::text, 6, '0'),
           n.cl, n.pl
    from named n
    union all
    select 2, 'overhead', 'Unallocated overhead', null::text, null::text, null::text where v_unallocated
    union all
    select 3, 'total', 'Total', null::text, null::text, null::text
  ),
  keyed as (
    select 1 as kind_ord, fk.gkey, fk.measure, fk.amount from fk where fk.gkey is not null
    union all
    select 2, 'overhead', fk.measure, fk.amount from fk where fk.measure = 'overhead' and v_unallocated
    union all
    select 3, 'total', fk.measure, fk.amount from fk
  ),
  sums as (
    select h.kind_ord, h.gkey, h.label, h.sort_key, h.cl, h.pl,
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
    group by h.kind_ord, h.gkey, h.label, h.sort_key, h.cl, h.pl
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
         case when (r.rh2 + r.fe2 - r.di2) <= 0 then null
              else round(r.net_exact / r.rev_exact * 100, 1)::text end,
         r.iv2::numeric(14, 2)::text,
         r.co2::numeric(14, 2)::text,
         r.cl,
         r.pl
  from r
  order by r.kind_ord, r.sort_key collate "C";
end;
$$;

revoke execute on function public.pnl_report(uuid, date, date, text, uuid[], uuid[]) from public, anon;
grant execute on function public.pnl_report(uuid, date, date, text, uuid[], uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
create function public.pnl_breakdown(
  p_firm uuid,
  p_from date,
  p_to date,
  p_group text,
  p_clients uuid[],
  p_projects uuid[],
  p_split_project boolean
)
returns table (
  group_key text,
  client_id uuid,
  client_label text,
  project_id uuid,
  project_label text,
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
  -- Client grouping always splits by project; that is its only breakdown.
  v_by_project boolean := p_group = 'client' or coalesce(p_split_project, false);
begin
  if not public.has_role(p_firm, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if p_group is null or p_group not in ('month', 'quarter', 'client') then
    raise exception 'PNL_GROUP_INVALID' using errcode = 'P0001';
  end if;

  if p_from is null or p_to is null or p_to < p_from or p_to > p_from + interval '3 years' then
    raise exception 'PNL_RANGE_INVALID' using errcode = 'P0001';
  end if;

  return query
  with fk as (
    select x.measure, x.amount, x.client_id as cid,
           case when v_by_project then x.project_id end as pid,
           case when v_periodic then date_trunc(v_unit, x.fact_date::timestamp) end as pstart
    from public.pnl_facts(p_firm, p_from, p_to) x
    where (p_clients is null or x.client_id = any (p_clients))
      and (p_projects is null or x.project_id = any (p_projects))
      -- Under client grouping, overhead (no client) belongs to pnl_report's
      -- Unallocated overhead row, not to a client.
      and (v_periodic or x.client_id is not null)
  ),
  sums as (
    select fk.pstart, fk.cid, fk.pid,
           coalesce(sum(fk.amount) filter (where fk.measure = 'revenue_hours'), 0) as rh,
           coalesce(sum(fk.amount) filter (where fk.measure = 'revenue_fees'), 0) as fe,
           coalesce(sum(fk.amount) filter (where fk.measure = 'discount'), 0) as di,
           coalesce(sum(fk.amount) filter (where fk.measure = 'labour'), 0) as la,
           coalesce(sum(fk.amount) filter (where fk.measure = 'direct_expense'), 0) as de,
           coalesce(sum(fk.amount) filter (where fk.measure = 'overhead'), 0) as ov,
           coalesce(sum(fk.amount) filter (where fk.measure = 'invoiced'), 0) as iv,
           coalesce(sum(fk.amount) filter (where fk.measure = 'collected'), 0) as co
    from fk
    group by fk.pstart, fk.cid, fk.pid
    having bool_or(fk.amount <> 0)
  ),
  r as (
    select s.*,
           c.name::text as cname, p.name::text as pname,
           round(s.rh, 2) as rh2, round(s.fe, 2) as fe2, round(s.di, 2) as di2,
           round(s.la, 2) as la2, round(s.de, 2) as de2, round(s.ov, 2) as ov2,
           round(s.iv, 2) as iv2, round(s.co, 2) as co2,
           s.rh + s.fe - s.di as rev_exact,
           s.rh + s.fe - s.di - s.la - s.de - s.ov as net_exact
    from sums s
    left join public.clients c on c.firm_id = p_firm and c.id = s.cid
    left join public.projects p on p.firm_id = p_firm and p.id = s.pid
  ),
  ordered as (
    select r.*,
           row_number() over (
             order by r.pstart,
                      (r.cid is null), lower(r.cname), r.cname, r.cid::text,
                      (r.pid is null), lower(r.pname), r.pname, r.pid::text
           ) as ord
    from r
  )
  select case when v_periodic then to_char(o.pstart, 'YYYY-MM-DD') else o.cid::text end,
         o.cid,
         case when o.cid is null then 'Overhead' else o.cname end,
         o.pid,
         case when not v_by_project or o.cid is null then null
              when o.pid is null then 'no project'
              else o.pname end,
         lpad(o.ord::text, 6, '0'),
         o.rh2::numeric(14, 2)::text,
         o.fe2::numeric(14, 2)::text,
         o.di2::numeric(14, 2)::text,
         (o.rh2 + o.fe2 - o.di2)::numeric(14, 2)::text,
         o.la2::numeric(14, 2)::text,
         (o.rh2 + o.fe2 - o.di2 - o.la2)::numeric(14, 2)::text,
         o.de2::numeric(14, 2)::text,
         o.ov2::numeric(14, 2)::text,
         (o.rh2 + o.fe2 - o.di2 - o.la2 - o.de2 - o.ov2)::numeric(14, 2)::text,
         case when (o.rh2 + o.fe2 - o.di2) <= 0 then null
              else round(o.net_exact / o.rev_exact * 100, 1)::text end,
         o.iv2::numeric(14, 2)::text,
         o.co2::numeric(14, 2)::text
  from ordered o
  order by o.ord;
end;
$$;

revoke execute on function public.pnl_breakdown(uuid, date, date, text, uuid[], uuid[], boolean) from public, anon;
grant execute on function public.pnl_breakdown(uuid, date, date, text, uuid[], uuid[], boolean) to authenticated;
