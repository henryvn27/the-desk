-- Desk sync is an append-only operation log. The desktop remains authoritative
-- locally; this table stores authenticated account-scoped copies for replay and
-- conflict inspection. No privileged key is required by the Electron client.
create table if not exists public.desk_sync_operations (
  operation_id uuid primary key,
  account_id uuid not null references auth.users (id) on delete cascade,
  entity_id text not null check (char_length(entity_id) between 1 and 200),
  operation text not null check (char_length(operation) between 1 and 100),
  payload jsonb not null,
  created_at timestamptz not null,
  inserted_at timestamptz not null default now()
);

create index if not exists desk_sync_operations_account_entity_created_idx
  on public.desk_sync_operations (account_id, entity_id, created_at desc);

alter table public.desk_sync_operations enable row level security;

revoke all on table public.desk_sync_operations from anon;
grant select, insert on table public.desk_sync_operations to authenticated;

drop policy if exists "Desk users read their own sync operations"
  on public.desk_sync_operations;
create policy "Desk users read their own sync operations"
  on public.desk_sync_operations
  for select
  to authenticated
  using ((select auth.uid()) = account_id);

drop policy if exists "Desk users append their own sync operations"
  on public.desk_sync_operations;
create policy "Desk users append their own sync operations"
  on public.desk_sync_operations
  for insert
  to authenticated
  with check ((select auth.uid()) = account_id);
