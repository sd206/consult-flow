-- Payments against issued invoices, and file attachments on payments.
--
-- Clients read both tables (admins/managers only) and never write them; every
-- write goes through the security-definer functions below, which keep
-- invoices.amount_paid and invoices.status in step with the payments.
--
-- Lock order: invoice row (FOR UPDATE) -> payment row -> attachment rows.
-- Functions that start from a payment or attachment resolve its invoice id
-- without locking anything, lock the invoice, then re-read (and lock) the
-- payment, so every change to an invoice's payments is serialised on the
-- invoice row. void_invoice / issue_invoice / set_invoice_pdf also lock the
-- invoice row first, so they serialise with payment changes too, and
-- void_invoice already refuses an invoice with amount_paid > 0.

create type public.payment_method as enum ('bank_transfer', 'check', 'card', 'cash', 'other');

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  invoice_id uuid not null,
  amount numeric(12, 2) not null,
  paid_on date not null,
  method public.payment_method not null,
  reference text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint payments_firm_id_id_key unique (firm_id, id),
  constraint payments_invoice_fk foreign key (firm_id, invoice_id)
    references public.invoices (firm_id, id) on delete restrict,
  constraint payments_amount_chk check (amount > 0),
  constraint payments_reference_len_chk
    check (reference is null or char_length(reference) <= 120),
  constraint payments_notes_len_chk
    check (notes is null or char_length(notes) <= 1000)
);
create index payments_firm_invoice_idx on public.payments (firm_id, invoice_id);
create index payments_firm_paid_on_idx on public.payments (firm_id, paid_on);

create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Attachments (Phase 5 adds expense_id and an "exactly one owner" check)
-- ---------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  payment_id uuid,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint attachments_firm_id_id_key unique (firm_id, id),
  constraint attachments_storage_path_key unique (storage_path),
  constraint attachments_payment_fk foreign key (firm_id, payment_id)
    references public.payments (firm_id, id) on delete cascade,
  constraint attachments_owner_chk check (payment_id is not null),
  constraint attachments_mime_chk
    check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/heic')),
  constraint attachments_size_chk check (size_bytes > 0 and size_bytes <= 10485760),
  constraint attachments_path_chk
    check (storage_path like 'firms/' || firm_id::text || '/attachments/%')
);
create index attachments_firm_payment_idx on public.attachments (firm_id, payment_id);

create trigger attachments_set_updated_at before update on public.attachments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges and RLS: admins/managers read; no direct writes.
-- ---------------------------------------------------------------------------
alter table public.payments enable row level security;
alter table public.attachments enable row level security;

revoke all on public.payments, public.attachments from anon, authenticated;
grant select on public.payments, public.attachments to authenticated;

create policy payments_select on public.payments
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));
create policy attachments_select on public.attachments
  for select to authenticated using (public.has_role(firm_id, '{admin,manager}'));

-- ---------------------------------------------------------------------------
-- Internal: recompute amount_paid and status from the payments. The caller
-- holds the invoice row lock. Only issued / partly_paid / paid invoices are
-- touched (draft and void take no payment changes).
-- ---------------------------------------------------------------------------
create function public.invoice_apply_payments(p_invoice uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_paid numeric(12, 2);
begin
  select * into v_inv from public.invoices i where i.id = p_invoice;
  if not found or v_inv.status not in ('issued', 'partly_paid', 'paid') then
    return;
  end if;

  select coalesce(sum(p.amount), 0) into v_paid
  from public.payments p
  where p.firm_id = v_inv.firm_id and p.invoice_id = v_inv.id;

  -- Backstop: record_payment checks this first, so it never fires there.
  if v_paid > v_inv.total then
    raise exception 'PAYMENT_TOO_LARGE' using errcode = 'P0001';
  end if;

  update public.invoices i
  set amount_paid = v_paid,
      status = case
        when v_paid = 0 then 'issued'::public.invoice_status
        when v_paid < i.total then 'partly_paid'::public.invoice_status
        else 'paid'::public.invoice_status
      end
  where i.id = v_inv.id;
end;
$$;

revoke execute on function public.invoice_apply_payments(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal: lock a payment for a change. Resolves the invoice id without
-- locking, locks the invoice, re-reads and locks the payment (raising
-- p_missing if it vanished meanwhile), checks the role and that the invoice
-- still takes payment changes (PAYMENT_LOCKED otherwise).
-- ---------------------------------------------------------------------------
create function public.payment_lock(p_payment uuid, p_missing text)
returns public.payments
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_invoice uuid;
  v_inv public.invoices%rowtype;
  v_pay public.payments%rowtype;
begin
  select p.invoice_id into v_invoice from public.payments p where p.id = p_payment;
  if not found then
    raise exception '%', p_missing using errcode = 'P0001';
  end if;

  select * into v_inv from public.invoices i where i.id = v_invoice for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_pay from public.payments p
  where p.id = p_payment and p.firm_id = v_inv.firm_id and p.invoice_id = v_inv.id
  for update;
  if not found then
    raise exception '%', p_missing using errcode = 'P0001';
  end if;

  if not public.has_role(v_inv.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_inv.status not in ('issued', 'partly_paid', 'paid') then
    raise exception 'PAYMENT_LOCKED' using errcode = 'P0001';
  end if;

  return v_pay;
end;
$$;

revoke execute on function public.payment_lock(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Record a payment on an issued or partly paid invoice. Returns its id.
-- ---------------------------------------------------------------------------
create function public.record_payment(
  p_invoice uuid,
  p_amount numeric,
  p_paid_on date,
  p_method public.payment_method,
  p_reference text,
  p_notes text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_amount numeric := round(p_amount, 2);
  v_id uuid;
begin
  -- Locking first serialises concurrent payments on the same invoice, so the
  -- balance check below always sees the committed amount_paid.
  select * into v_inv from public.invoices i where i.id = p_invoice for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.has_role(v_inv.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_inv.status not in ('issued', 'partly_paid') then
    raise exception 'PAYMENT_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  if p_paid_on > current_date then
    raise exception 'PAYMENT_FUTURE' using errcode = 'P0001';
  end if;

  -- A non-positive amount falls through to payments_amount_chk on insert.
  if v_amount > 0 and v_inv.amount_paid + v_amount > v_inv.total then
    raise exception 'PAYMENT_TOO_LARGE' using errcode = 'P0001';
  end if;

  insert into public.payments (firm_id, invoice_id, amount, paid_on, method, reference, notes)
  values (
    v_inv.firm_id, v_inv.id, v_amount, p_paid_on, p_method,
    nullif(btrim(p_reference), ''), nullif(btrim(p_notes), '')
  )
  returning id into v_id;

  perform public.invoice_apply_payments(v_inv.id);
  return v_id;
end;
$$;

revoke execute on function public.record_payment(uuid, numeric, date, public.payment_method, text, text)
  from public, anon;
grant execute on function public.record_payment(uuid, numeric, date, public.payment_method, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Edit a payment's date, method, reference and notes. The amount never changes.
-- ---------------------------------------------------------------------------
create function public.update_payment_details(
  p_payment uuid,
  p_paid_on date,
  p_method public.payment_method,
  p_reference text,
  p_notes text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
begin
  v_pay := public.payment_lock(p_payment, 'PAYMENT_NOT_FOUND');

  if p_paid_on > current_date then
    raise exception 'PAYMENT_FUTURE' using errcode = 'P0001';
  end if;

  update public.payments p
  set paid_on = p_paid_on,
      method = p_method,
      reference = nullif(btrim(p_reference), ''),
      notes = nullif(btrim(p_notes), '')
  where p.id = v_pay.id;
end;
$$;

revoke execute on function public.update_payment_details(uuid, date, public.payment_method, text, text)
  from public, anon;
grant execute on function public.update_payment_details(uuid, date, public.payment_method, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Delete a payment (its attachments cascade) and recompute the invoice.
-- Returns the attachments' storage paths so the app can remove the files.
-- ---------------------------------------------------------------------------
create function public.delete_payment(p_payment uuid)
returns setof text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_paths text[];
begin
  v_pay := public.payment_lock(p_payment, 'PAYMENT_NOT_FOUND');

  select coalesce(array_agg(a.storage_path order by a.storage_path), '{}') into v_paths
  from (
    select a.storage_path from public.attachments a
    where a.firm_id = v_pay.firm_id and a.payment_id = v_pay.id
    order by a.id
    for update
  ) a;

  delete from public.payments p where p.id = v_pay.id;

  perform public.invoice_apply_payments(v_pay.invoice_id);

  return query select unnest(v_paths);
end;
$$;

revoke execute on function public.delete_payment(uuid) from public, anon;
grant execute on function public.delete_payment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Record an uploaded file on a payment. The path must be in the payment's
-- own folder: firms/{firm}/attachments/payments/{payment}/{file}.
-- ---------------------------------------------------------------------------
create function public.add_payment_attachment(
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

-- ---------------------------------------------------------------------------
-- Delete an attachment row. Returns its storage path so the app can remove
-- the file.
-- ---------------------------------------------------------------------------
create function public.delete_attachment(p_attachment uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_att public.attachments%rowtype;
  v_pay public.payments%rowtype;
begin
  select * into v_att from public.attachments a where a.id = p_attachment;
  if not found then
    raise exception 'ATTACHMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.has_role(v_att.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- Lock the owning invoice (then payment), then re-read the attachment.
  -- If the payment went meanwhile, its attachments went with it.
  v_pay := public.payment_lock(v_att.payment_id, 'ATTACHMENT_NOT_FOUND');

  delete from public.attachments a
  where a.id = v_att.id and a.firm_id = v_pay.firm_id and a.payment_id = v_pay.id
  returning a.* into v_att;
  if not found then
    raise exception 'ATTACHMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  return v_att.storage_path;
end;
$$;

revoke execute on function public.delete_attachment(uuid) from public, anon;
grant execute on function public.delete_attachment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- void_invoice: report INVOICE_HAS_PAYMENTS (not INVOICE_STATE) for a partly
-- paid or paid invoice by checking amount_paid before the status. Otherwise
-- unchanged from 20261109000015_invoice_issue.sql.
-- ---------------------------------------------------------------------------
create or replace function public.void_invoice(p_invoice uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
begin
  select * into v_inv from public.invoices i where i.id = p_invoice for update;
  if not found then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.has_role(v_inv.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_inv.amount_paid > 0 then
    raise exception 'INVOICE_HAS_PAYMENTS' using errcode = 'P0001';
  end if;

  if v_inv.status <> 'issued' then
    raise exception 'INVOICE_STATE' using errcode = 'P0001';
  end if;

  update public.time_entries te
  set invoice_line_id = null
  where te.firm_id = v_inv.firm_id
    and te.invoice_line_id in (
      select l.id from public.invoice_lines l
      where l.firm_id = v_inv.firm_id and l.invoice_id = v_inv.id
    );

  update public.invoices i
  set status = 'void', voided_at = now(), voided_by = auth.uid()
  where i.id = v_inv.id;
end;
$$;

revoke execute on function public.void_invoice(uuid) from public, anon;
grant execute on function public.void_invoice(uuid) to authenticated;
