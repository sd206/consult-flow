-- Bulk "Mark as duplicate": each selected New line with exactly one matching,
-- unmatched payment (money in) or expense (money out) of the same amount within
-- 7 days is linked to it; any other New line is ignored with the reason "Duplicate".
-- Lines no longer New are skipped. Lines are handled in the order given, so an
-- entry matched by an earlier line is no longer a candidate for a later one.
create function public.mark_bank_lines_duplicate(p_lines uuid[])
returns table (matched integer, ignored integer, skipped integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.bank_lines%rowtype;
  v_id uuid;
  v_ids uuid[];
  v_matched integer := 0;
  v_ignored integer := 0;
  v_skipped integer := 0;
begin
  if exists (
    select 1 from public.bank_lines l
    where l.id = any (p_lines) and not public.has_role(l.firm_id, '{admin,manager}'::public.firm_role[])
  ) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  for v_id in select x.id from unnest(p_lines) with ordinality as x(id, n) order by x.n loop
    select * into v from public.bank_lines l where l.id = v_id for update;
    if not found or v.status <> 'new' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v.amount > 0 then
      select array_agg(p.id) into v_ids
      from public.payments p
      where p.firm_id = v.firm_id
        and p.amount = v.amount
        and p.paid_on between v.posted_on - 7 and v.posted_on + 7
        and not exists (select 1 from public.bank_lines l where l.payment_id = p.id);
    else
      select array_agg(e.id) into v_ids
      from public.expenses e
      where e.firm_id = v.firm_id
        and e.amount = -v.amount
        and e.spent_on between v.posted_on - 7 and v.posted_on + 7
        and not exists (select 1 from public.bank_lines l where l.expense_id = e.id);
    end if;

    if coalesce(array_length(v_ids, 1), 0) = 1 then
      if v.amount > 0 then
        update public.bank_lines set payment_id = v_ids[1], status = 'done' where id = v.id;
      else
        update public.bank_lines set expense_id = v_ids[1], status = 'done' where id = v.id;
      end if;
      v_matched := v_matched + 1;
    else
      update public.bank_lines set status = 'ignored', ignore_reason = 'Duplicate' where id = v.id;
      v_ignored := v_ignored + 1;
    end if;
  end loop;

  return query select v_matched, v_ignored, v_skipped;
end;
$$;

revoke execute on function public.mark_bank_lines_duplicate(uuid[]) from public, anon;
grant execute on function public.mark_bank_lines_duplicate(uuid[]) to authenticated;
