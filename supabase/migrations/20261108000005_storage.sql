-- Private firm file bucket. Object paths: firms/{firm_id}/...
-- Logos live under firms/{firm_id}/logo/ (admin-only write); other paths
-- under the firm are admin/manager write. All members can read.

insert into storage.buckets (id, name, public, file_size_limit)
values ('firm-files', 'firm-files', false, 10485760)
on conflict (id) do update
  set public = false, file_size_limit = 10485760;

-- Parses the firm id from an object path. Never raises: returns null unless
-- the path is firms/{uuid}/...
create function public.storage_firm_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1] = 'firms'
     and (storage.foldername(p_name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_name))[2])::uuid
    else null
  end
$$;

revoke execute on function public.storage_firm_id(text) from public, anon;
grant execute on function public.storage_firm_id(text) to authenticated, service_role;

create policy firm_files_select on storage.objects for select to authenticated
  using (
    bucket_id = 'firm-files'
    and public.storage_firm_id(name) is not null
    and public.is_member(public.storage_firm_id(name))
  );

create policy firm_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'firm-files'
    and public.storage_firm_id(name) is not null
    and public.has_role(
      public.storage_firm_id(name),
      case when (storage.foldername(name))[3] = 'logo'
           then '{admin}'::public.firm_role[]
           else '{admin,manager}'::public.firm_role[] end
    )
  );

create policy firm_files_update on storage.objects for update to authenticated
  using (
    bucket_id = 'firm-files'
    and public.storage_firm_id(name) is not null
    and public.has_role(
      public.storage_firm_id(name),
      case when (storage.foldername(name))[3] = 'logo'
           then '{admin}'::public.firm_role[]
           else '{admin,manager}'::public.firm_role[] end
    )
  )
  with check (
    bucket_id = 'firm-files'
    and public.storage_firm_id(name) is not null
    and public.has_role(
      public.storage_firm_id(name),
      case when (storage.foldername(name))[3] = 'logo'
           then '{admin}'::public.firm_role[]
           else '{admin,manager}'::public.firm_role[] end
    )
  );

create policy firm_files_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'firm-files'
    and public.storage_firm_id(name) is not null
    and public.has_role(
      public.storage_firm_id(name),
      case when (storage.foldername(name))[3] = 'logo'
           then '{admin}'::public.firm_role[]
           else '{admin,manager}'::public.firm_role[] end
    )
  );
