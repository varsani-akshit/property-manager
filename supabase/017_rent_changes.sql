-- Migration 017: track each rent change per lease.
create table if not exists public.lease_rent_changes (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references public.leases(id) on delete cascade,
  effective_date date not null,
  old_amount numeric(14,2) not null,
  new_amount numeric(14,2) not null check (new_amount >= 0),
  reason text,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_rent_changes_lease on public.lease_rent_changes(lease_id);
create index if not exists idx_rent_changes_effective on public.lease_rent_changes(effective_date);

alter table public.lease_rent_changes enable row level security;
drop policy if exists rent_changes_rw on public.lease_rent_changes;
create policy rent_changes_rw on public.lease_rent_changes
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
