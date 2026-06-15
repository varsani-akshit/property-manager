-- Add a deposit_amount column to leases — collected upfront, separate from rent.
alter table public.leases
  add column if not exists deposit_amount numeric(14,2) not null default 0
    check (deposit_amount >= 0);
