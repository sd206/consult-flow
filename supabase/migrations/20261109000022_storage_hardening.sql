-- Phase 5: storage write model for firm-files.
--
-- Under firms/{firm}/attachments/ users may only create holding objects
-- (firms/{firm}/attachments/{payments|expenses}/{owner}/incoming-*); they may
-- never update or delete there. Under firms/{firm}/invoices/ they may create
-- but not update or delete. Moves and removals in those folders are done by
-- server code with the service role after the app's own checks.
-- Logo rules are unchanged; firm_files_select is unchanged.

drop policy firm_files_insert on storage.objects;
drop policy firm_files_update on storage.objects;
drop policy firm_files_delete on storage.objects;

create policy firm_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'firm-files'
    and public.storage_firm_id(name) is not null
    and case
      when (storage.foldername(name))[3] = 'logo' then
        public.has_role(public.storage_firm_id(name), '{admin}'::public.firm_role[])
      when (storage.foldername(name))[3] = 'attachments' then
        public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
        and array_length(storage.foldername(name), 1) = 5
        and (storage.foldername(name))[4] in ('payments', 'expenses')
        and storage.filename(name) like 'incoming-%'
      when (storage.foldername(name))[3] = 'invoices' then
        public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
      else
        public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
    end
  );

create policy firm_files_update on storage.objects for update to authenticated
  using (
    bucket_id = 'firm-files'
    and public.storage_firm_id(name) is not null
    and case
      when (storage.foldername(name))[3] = 'logo' then
        public.has_role(public.storage_firm_id(name), '{admin}'::public.firm_role[])
      when (storage.foldername(name))[3] in ('attachments', 'invoices') then
        false
      else
        public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
    end
  )
  with check (
    bucket_id = 'firm-files'
    and public.storage_firm_id(name) is not null
    and case
      when (storage.foldername(name))[3] = 'logo' then
        public.has_role(public.storage_firm_id(name), '{admin}'::public.firm_role[])
      when (storage.foldername(name))[3] in ('attachments', 'invoices') then
        false
      else
        public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
    end
  );

create policy firm_files_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'firm-files'
    and public.storage_firm_id(name) is not null
    and case
      when (storage.foldername(name))[3] = 'logo' then
        public.has_role(public.storage_firm_id(name), '{admin}'::public.firm_role[])
      when (storage.foldername(name))[3] in ('attachments', 'invoices') then
        false
      else
        public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
    end
  );
