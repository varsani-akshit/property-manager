-- Migration 013: require lessee document URL on every lease.
-- Safe because the leases table was wiped in the previous cleanup step.
alter table public.leases
  alter column lessee_doc_url set not null;
