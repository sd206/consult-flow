-- Imported deposits that could pay an invoice: New money-in bank lines in the
-- invoice's firm, from the last 90 days, no larger than the balance due.
-- Exact-balance matches first, then descriptions naming the client, then newest.
-- Admin/manager only (42501). Recording one uses confirm_bank_line_payment.
create function public.invoice_bank_deposits(p_invoice uuid)
returns table (
  line_id uuid,
  posted_on date,
  amount text,
  description text,
  account_name text,
  account_kind text,
  exact_match boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_balance numeric;
  v_word text;
begin
  select * into v_inv from public.invoices i where i.id = p_invoice;
  if not found or not public.has_role(v_inv.firm_id, '{admin,manager}'::public.firm_role[]) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  v_balance := v_inv.total - v_inv.amount_paid;
  select upper(split_part(btrim(c.name), ' ', 1)) into v_word
  from public.clients c where c.firm_id = v_inv.firm_id and c.id = v_inv.client_id;

  return query
  select l.id, l.posted_on, l.amount::text, l.description, a.name, a.kind::text, l.amount = v_balance
  from public.bank_lines l
  join public.bank_accounts a on a.firm_id = l.firm_id and a.id = l.account_id
  where l.firm_id = v_inv.firm_id
    and l.status = 'new'
    and l.amount > 0
    and l.amount <= v_balance
    and l.posted_on >= current_date - 90
  order by
    (l.amount = v_balance) desc,
    (v_word <> '' and position(v_word in upper(l.description)) > 0) desc,
    l.posted_on desc,
    l.created_at desc,
    l.id
  limit 20;
end;
$$;

revoke execute on function public.invoice_bank_deposits(uuid) from public, anon;
grant execute on function public.invoice_bank_deposits(uuid) to authenticated;
