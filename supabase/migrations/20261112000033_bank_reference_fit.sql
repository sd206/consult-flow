-- A bank id (FITID) can be up to 255 characters; payment references allow 120.
-- Cut whichever is used so Confirm payment never fails on payments_reference_len_chk.
create or replace function public.confirm_bank_line_payment(p_line uuid, p_invoice uuid, p_notes text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.bank_lines%rowtype;
  v_kind public.bank_account_kind;
  v_id uuid;
begin
  v := public.bank_lock_line(p_line, '{new}');
  if v.amount <= 0 then
    raise exception 'LINE_DIRECTION' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.invoices i where i.id = p_invoice and i.firm_id = v.firm_id) then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;
  select a.kind into v_kind from public.bank_accounts a where a.id = v.account_id;

  v_id := public.record_payment(
    p_invoice,
    v.amount,
    v.posted_on,
    (case when v_kind = 'credit_card' then 'card' else 'bank_transfer' end)::public.payment_method,
    left(coalesce(v.bank_ref, v.description), 120),
    p_notes
  );
  update public.bank_lines set payment_id = v_id, status = 'done' where id = v.id;
  return v_id;
end;
$$;
