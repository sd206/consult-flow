-- Managers may edit firm settings (details, logo, invoice number pattern, defaults)
-- and invoice templates. Members, roles and the audit log stay admin-only.

drop policy firms_update on public.firms;
create policy firms_update on public.firms
  for update to authenticated
  using (public.has_role(id, '{admin,manager}'))
  with check (public.has_role(id, '{admin,manager}'));

drop policy invoice_templates_insert on public.invoice_templates;
drop policy invoice_templates_update on public.invoice_templates;
drop policy invoice_templates_delete on public.invoice_templates;
create policy invoice_templates_insert on public.invoice_templates
  for insert to authenticated with check (public.has_role(firm_id, '{admin,manager}'));
create policy invoice_templates_update on public.invoice_templates
  for update to authenticated
  using (public.has_role(firm_id, '{admin,manager}'))
  with check (public.has_role(firm_id, '{admin,manager}'));
create policy invoice_templates_delete on public.invoice_templates
  for delete to authenticated using (public.has_role(firm_id, '{admin,manager}'));

create or replace function public.set_default_template(p_template uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_firm uuid;
begin
  select t.firm_id into v_firm from public.invoice_templates t where t.id = p_template;
  if not found then
    raise exception 'TEMPLATE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.has_role(v_firm, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- Lock the firm's templates so concurrent calls serialize. No key changes,
  -- so FOR NO KEY UPDATE (invoice FK checks still proceed).
  perform 1 from public.invoice_templates t
  where t.firm_id = v_firm
  order by t.id
  for no key update;

  -- Clear first, then set, so invoice_templates_one_default never sees two.
  update public.invoice_templates t
  set is_default = false
  where t.firm_id = v_firm and t.is_default and t.id <> p_template;

  update public.invoice_templates t
  set is_default = true
  where t.firm_id = v_firm and t.id = p_template and not t.is_default;
end;
$$;

-- Logo files: same rules as before, with managers allowed alongside admins.
drop policy firm_files_insert on storage.objects;
drop policy firm_files_update on storage.objects;
drop policy firm_files_delete on storage.objects;

create policy firm_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'firm-files'
    and public.storage_firm_id(name) is not null
    and case
      when (storage.foldername(name))[3] = 'logo' then
        public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
      when (storage.foldername(name))[3] = 'attachments' then
        public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
        and array_length(storage.foldername(name), 1) = 5
        and (storage.foldername(name))[4] in ('payments', 'expenses')
        and (storage.foldername(name))[5] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and storage.filename(name) ~ '^incoming-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
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
        public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
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
        public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
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
        public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
      when (storage.foldername(name))[3] in ('attachments', 'invoices') then
        false
      else
        public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
    end
  );
