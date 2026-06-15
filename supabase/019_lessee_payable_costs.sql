-- =============================================================================
-- Migration 019: lessee-payable costs (one-time charges billed to a lessee)
-- =============================================================================
-- A cost can now be flagged `payable_by_lessee = true`, which means we are
-- billing a specific lessee for it. The lessee owes us the amount; it is
-- collected like rent and shows up under the lessee in /rent.
--
-- Landlord-paid costs (payable_by_lessee = false) keep their existing flow:
-- cost_allocations split across properties by sqft. Lessee-payable costs
-- are tied to ONE lease (and therefore one property) — no sqft split.
-- =============================================================================

alter table public.costs
  add column if not exists payable_by_lessee boolean not null default false,
  add column if not exists lease_id uuid references public.leases(id) on delete set null,
  add column if not exists due_date date,
  add column if not exists collected_amount numeric(14,2) not null default 0,
  add column if not exists collected_at timestamptz,
  add column if not exists collected_by uuid references auth.users(id),
  add column if not exists collection_status text
    check (collection_status in ('due','partial','collected'));

-- Lookup index for the rent page (fetch all unpaid + recently collected per lease)
create index if not exists idx_costs_lease on public.costs(lease_id)
  where payable_by_lessee = true;

create index if not exists idx_costs_collection_status on public.costs(collection_status)
  where payable_by_lessee = true;
