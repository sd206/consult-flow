-- Firm settings hardening.
-- (a) Only the future invoice-issue function may advance the invoice sequence.
revoke update (invoice_next_seq) on public.firms from authenticated;

-- (b) The invoice pattern must contain a {SEQ:n} token with n in 1..8.
alter table public.firms
  add constraint firms_invoice_pattern_seq_chk
  check (invoice_number_pattern ~ '\{SEQ:[1-8]\}');

-- (c) Payment terms upper bound. (default_tax_percent already has a 0..100 check in core_tenancy.)
alter table public.firms
  add constraint firms_payment_terms_chk
  check (default_payment_terms_days between 0 and 365);
