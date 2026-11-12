-- 1) Consultants, their cost rates and vendors are set up by Admins only.
--    Managers keep read access (they pick consultants for projects, approve
--    timesheets and build invoices from them).
drop policy consultants_insert on public.consultants;
drop policy consultants_update on public.consultants;
drop policy consultants_delete on public.consultants;
create policy consultants_insert on public.consultants
  for insert to authenticated with check (public.has_role(firm_id, '{admin}'));
create policy consultants_update on public.consultants
  for update to authenticated
  using (public.has_role(firm_id, '{admin}'))
  with check (public.has_role(firm_id, '{admin}'));
create policy consultants_delete on public.consultants
  for delete to authenticated using (public.has_role(firm_id, '{admin}'));

drop policy consultant_cost_rates_insert on public.consultant_cost_rates;
drop policy consultant_cost_rates_update on public.consultant_cost_rates;
drop policy consultant_cost_rates_delete on public.consultant_cost_rates;
create policy consultant_cost_rates_insert on public.consultant_cost_rates
  for insert to authenticated with check (public.has_role(firm_id, '{admin}'));
create policy consultant_cost_rates_update on public.consultant_cost_rates
  for update to authenticated
  using (public.has_role(firm_id, '{admin}'))
  with check (public.has_role(firm_id, '{admin}'));
create policy consultant_cost_rates_delete on public.consultant_cost_rates
  for delete to authenticated using (public.has_role(firm_id, '{admin}'));

drop policy vendors_insert on public.vendors;
drop policy vendors_update on public.vendors;
drop policy vendors_delete on public.vendors;
create policy vendors_insert on public.vendors
  for insert to authenticated with check (public.has_role(firm_id, '{admin}'));
create policy vendors_update on public.vendors
  for update to authenticated
  using (public.has_role(firm_id, '{admin}'))
  with check (public.has_role(firm_id, '{admin}'));
create policy vendors_delete on public.vendors
  for delete to authenticated using (public.has_role(firm_id, '{admin}'));

-- 2) For the Users page: which members never accepted their invitation and
--    which have never signed in. Admins of the firm only (42501).
create function public.firm_member_logins(p_firm uuid)
returns table (user_id uuid, invite_pending boolean, signed_in boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role(p_firm, '{admin}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
  select m.user_id,
         (u.invited_at is not null and u.email_confirmed_at is null),
         u.last_sign_in_at is not null
  from public.firm_members m
  join auth.users u on u.id = m.user_id
  where m.firm_id = p_firm;
end;
$$;

revoke execute on function public.firm_member_logins(uuid) from public, anon;
grant execute on function public.firm_member_logins(uuid) to authenticated;
