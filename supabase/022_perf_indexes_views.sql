-- =============================================================================
-- Migration 022: performance indexes + aggregate views
-- =============================================================================
-- Kills a bunch of "fetch everything just to count/sum" queries and adds
-- indexes covering the app's hot filters.
-- =============================================================================

-- Rent-per-property counters (used by /rent/backfill index)
create or replace view public.v_rent_rows_by_property as
  select property_id, count(*)::int as row_count
  from public.rent_collections
  group by property_id;

-- Service-charges totals per status (used by /service-charges KPIs)
create or replace view public.v_sc_status_totals as
  select status,
         count(*)::int    as row_count,
         coalesce(sum(amount), 0)::numeric(14,2) as amount_sum
  from public.service_charges
  group by status;

-- =============================================================================
-- Indexes covering the most common filters
-- =============================================================================

-- rent_collections is the biggest table (rows × leases × months)
create index if not exists idx_rent_property_status
  on public.rent_collections(property_id, status);
create index if not exists idx_rent_lease_status
  on public.rent_collections(lease_id, status);
create index if not exists idx_rent_due_date
  on public.rent_collections(due_date);
create index if not exists idx_rent_collected_at
  on public.rent_collections(collected_at)
  where status = 'collected';

-- service_charges
create index if not exists idx_sc_status
  on public.service_charges(status);
create index if not exists idx_sc_property_status
  on public.service_charges(property_id, status);

-- costs (lessee-payable subset used on /rent)
create index if not exists idx_costs_lease_status
  on public.costs(lease_id, collection_status)
  where payable_by_lessee = true;

-- cost_allocations (join back to costs for expense reports)
create index if not exists idx_cost_alloc_prop
  on public.cost_allocations(property_id);
create index if not exists idx_cost_alloc_cost
  on public.cost_allocations(cost_id);

-- leases (active-lease lookups everywhere)
create index if not exists idx_leases_property_active
  on public.leases(property_id, active);

analyze public.rent_collections;
analyze public.service_charges;
analyze public.costs;
analyze public.cost_allocations;
analyze public.leases;
