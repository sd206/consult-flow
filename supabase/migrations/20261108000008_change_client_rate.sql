-- Atomically end the current client-rate assignment and start a new one.
-- security invoker: RLS applies, so only admin/manager of the firm can use it.

create function public.change_client_rate(p_assignment uuid, p_rate numeric, p_from date)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old public.project_assignments%rowtype;
  new_id uuid;
begin
  select * into old
  from public.project_assignments
  where id = p_assignment
  for update;

  if not found then
    raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_from <= old.effective_from
     or (old.effective_to is not null and old.effective_to < p_from) then
    raise exception 'RATE_DATE_INVALID' using errcode = 'P0001';
  end if;

  update public.project_assignments
  set effective_to = p_from - 1
  where id = old.id;

  insert into public.project_assignments
    (firm_id, project_id, consultant_id, client_rate, effective_from, effective_to)
  values
    (old.firm_id, old.project_id, old.consultant_id, p_rate, p_from, old.effective_to)
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function public.change_client_rate(uuid, numeric, date) from public, anon;
grant execute on function public.change_client_rate(uuid, numeric, date) to authenticated;
