-- Audit log: append-only record of row changes, written only by trigger.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id),
  actor_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index audit_log_firm_at_idx on public.audit_log (firm_id, at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

alter table public.audit_log enable row level security;

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

-- Admins read; no insert/update/delete policies (writes only via audit_row()).
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.has_role(firm_id, '{admin}'));

-- Generic audit trigger: works for any table with `id` and `firm_id` columns.
create function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  insert into public.audit_log (firm_id, actor_id, entity_type, entity_id, action, before, after)
  values (
    (v_row ->> 'firm_id')::uuid,
    auth.uid(),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end;
$$;
revoke execute on function public.audit_row() from public, anon, authenticated;

create trigger firm_members_audit
  after insert or update or delete on public.firm_members
  for each row execute function public.audit_row();
