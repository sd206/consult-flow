-- Phase 1 whole-branch review fixes.

-- ---------------------------------------------------------------------------
-- I2: firm-files read access. Admins/managers read anything under firms/{fid}/;
-- every member reads only the logo folder firms/{fid}/logo/.
-- ---------------------------------------------------------------------------
drop policy firm_files_select on storage.objects;

create policy firm_files_select on storage.objects for select to authenticated
  using (
    bucket_id = 'firm-files'
    and public.storage_firm_id(name) is not null
    and (
      public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
      or (
        (storage.foldername(name))[3] = 'logo'
        and public.is_member(public.storage_firm_id(name))
      )
    )
  );

-- ---------------------------------------------------------------------------
-- I3: a firm's logo must live in that firm's own logo folder.
-- ---------------------------------------------------------------------------
alter table public.firms
  add constraint firms_logo_path_chk
  check (logo_path is null or logo_path like 'firms/' || id::text || '/logo/%');

-- ---------------------------------------------------------------------------
-- I5: firm admins add members through this function with their own session,
-- so the audit trigger records the admin as actor (not a null service role).
-- ---------------------------------------------------------------------------
create function public.add_firm_member(p_firm uuid, p_user uuid, p_role public.firm_role)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.has_role(p_firm, '{admin}'::public.firm_role[]) then
    raise exception 'permission denied to add members to this firm' using errcode = '42501';
  end if;

  insert into public.firm_members (firm_id, user_id, role)
  values (p_firm, p_user, p_role)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.add_firm_member(uuid, uuid, public.firm_role) from public, anon, service_role;
grant execute on function public.add_firm_member(uuid, uuid, public.firm_role) to authenticated;
