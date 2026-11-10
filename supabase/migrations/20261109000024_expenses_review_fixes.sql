-- Phase 5 final review fixes.
--
-- 1. add_payment_attachment / add_expense_attachment: the file must carry the
--    server's final name ({uuid}.{pdf|png|jpg|heic}). A holding object
--    (incoming-{uuid}) a user uploaded directly can no longer be registered
--    without the app's signature and size checks. Every other check is
--    unchanged from 20261109000018_payments.sql / 20261109000021_expenses.sql.
-- 2. firm_files_insert: under attachments/, the owner folder must be a uuid
--    and the holding name must be exactly incoming-{uuid}. All other branches
--    are unchanged from 20261109000022_storage_hardening.sql.

create or replace function public.add_payment_attachment(
  p_payment uuid,
  p_storage_path text,
  p_file_name text,
  p_mime text,
  p_size integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_prefix text;
  v_rest text;
  v_id uuid;
begin
  v_pay := public.payment_lock(p_payment, 'PAYMENT_NOT_FOUND');

  v_prefix := 'firms/' || v_pay.firm_id::text || '/attachments/payments/' || v_pay.id::text || '/';
  v_rest := substr(p_storage_path, length(v_prefix) + 1);
  if p_storage_path is null
     or left(p_storage_path, length(v_prefix)) <> v_prefix
     or v_rest !~ '^[^/]+$'
     or v_rest in ('.', '..') then
    raise exception 'attachments_path_chk: path is outside the payment folder'
      using errcode = '23514';
  end if;
  if v_rest !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|heic)$' then
    raise exception 'attachments_path_chk: not a stored file name'
      using errcode = '23514';
  end if;

  insert into public.attachments
    (firm_id, payment_id, storage_path, file_name, mime_type, size_bytes)
  values
    (v_pay.firm_id, v_pay.id, p_storage_path, left(btrim(p_file_name), 120), p_mime, p_size)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.add_payment_attachment(uuid, text, text, text, integer)
  from public, anon;
grant execute on function public.add_payment_attachment(uuid, text, text, text, integer)
  to authenticated;

create or replace function public.add_expense_attachment(
  p_expense uuid,
  p_storage_path text,
  p_file_name text,
  p_mime text,
  p_size integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_exp public.expenses%rowtype;
  v_prefix text;
  v_rest text;
  v_id uuid;
begin
  select * into v_exp from public.expenses e where e.id = p_expense for update;
  if not found then
    raise exception 'EXPENSE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.has_role(v_exp.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  v_prefix := 'firms/' || v_exp.firm_id::text || '/attachments/expenses/' || v_exp.id::text || '/';
  v_rest := substr(p_storage_path, length(v_prefix) + 1);
  if p_storage_path is null
     or left(p_storage_path, length(v_prefix)) <> v_prefix
     or v_rest !~ '^[^/]+$'
     or v_rest in ('.', '..') then
    raise exception 'attachments_path_chk: path is outside the expense folder'
      using errcode = '23514';
  end if;
  if v_rest !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|heic)$' then
    raise exception 'attachments_path_chk: not a stored file name'
      using errcode = '23514';
  end if;

  insert into public.attachments
    (firm_id, expense_id, storage_path, file_name, mime_type, size_bytes)
  values
    (v_exp.firm_id, v_exp.id, p_storage_path, left(btrim(p_file_name), 120), p_mime, p_size)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.add_expense_attachment(uuid, text, text, text, integer)
  from public, anon;
grant execute on function public.add_expense_attachment(uuid, text, text, text, integer)
  to authenticated;

drop policy firm_files_insert on storage.objects;

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
        and (storage.foldername(name))[5] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and storage.filename(name) ~ '^incoming-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      when (storage.foldername(name))[3] = 'invoices' then
        public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
      else
        public.has_role(public.storage_firm_id(name), '{admin,manager}'::public.firm_role[])
    end
  );
