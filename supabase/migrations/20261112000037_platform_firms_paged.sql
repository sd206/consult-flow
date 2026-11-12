-- The platform owner's firm list, one page at a time, newest first, with an
-- optional name search. The unpaged platform_list_firms returned oldest first
-- and the API caps responses at 1,000 rows, so new firms vanished from the
-- page once there were more than 1,000. total_count is the full match count.
-- Non-owners get no rows (same rule as platform_list_firms).
create function public.platform_firms(p_search text, p_limit integer, p_offset integer)
returns table (id uuid, name text, created_at timestamptz, admin_emails text[], total_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  with matched as (
    select f.id, f.name, f.created_at
    from public.firms f
    where public.is_platform_owner()
      and (
        nullif(btrim(p_search), '') is null
        or f.name ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
  )
  select
    m.id,
    m.name,
    m.created_at,
    array(
      select p.email
      from public.firm_members fm
      join public.profiles p on p.user_id = fm.user_id
      where fm.firm_id = m.id and fm.role = 'admin'
      order by p.email
    ),
    (select count(*)::integer from matched)
  from matched m
  order by m.created_at desc, m.id
  limit least(greatest(coalesce(p_limit, 50), 0), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function public.platform_firms(text, integer, integer) from public, anon;
grant execute on function public.platform_firms(text, integer, integer) to authenticated, service_role;
