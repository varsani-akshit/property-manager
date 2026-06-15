-- Migration 016: revert — lessee document URL is optional again.
alter table public.leases alter column lessee_doc_url drop not null;
