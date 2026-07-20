-- =============================================================================
-- Migration 021: split deposit into charged + collected
-- =============================================================================
-- Before: leases.deposit_amount was a single field — implicitly what we
-- expected to hold, with no way to track how much had actually been paid.
--
-- Now:
--   deposit_charged  = the amount we're asking the lessee to pay as deposit
--   deposit_collected = the amount actually received so far
-- Shortfall = charged - collected. Rolls into Total Outstanding on /rent.
-- Legacy `deposit_amount` stays as a copy of `deposit_charged` for anything
-- external still reading it.
-- =============================================================================

alter table public.leases
  add column if not exists deposit_charged   numeric(14,2) not null default 0,
  add column if not exists deposit_collected numeric(14,2) not null default 0;

-- Backfill: what the app used to call "deposit_amount" is what we asked for.
-- Assume it was fully collected on existing (already-signed) leases.
update public.leases
set deposit_charged   = coalesce(deposit_amount, 0),
    deposit_collected = coalesce(deposit_amount, 0)
where deposit_charged = 0 and deposit_collected = 0;
