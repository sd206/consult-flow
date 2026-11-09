-- Atomically create a firm together with its first Admin membership.
-- Service role only: called by the platform-owner action after an explicit permission check.
create function public.create_firm_with_admin(p_name text, p_admin uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_firm uuid;
begin
  insert into public.firms (name) values (btrim(p_name)) returning id into v_firm;
  insert into public.firm_members (firm_id, user_id, role) values (v_firm, p_admin, 'admin');
  return v_firm;
end;
$$;

revoke execute on function public.create_firm_with_admin(text, uuid) from public, anon, authenticated;
grant execute on function public.create_firm_with_admin(text, uuid) to service_role;
