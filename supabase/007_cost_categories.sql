-- =============================================================================
-- Migration 007: user-defined cost categories
-- =============================================================================

-- 1) Drop the hardcoded check constraint
alter table public.costs drop constraint if exists costs_category_check;

-- 2) cost_categories: free-form, user-created
create table if not exists public.cost_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.cost_categories enable row level security;
drop policy if exists cost_categories_rw on public.cost_categories;
create policy cost_categories_rw on public.cost_categories
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- 3) Seed with the previously-enforced defaults (idempotent)
insert into public.cost_categories (name) values
  ('general'),
  ('maintenance'),
  ('utilities'),
  ('tax'),
  ('service_charge'),
  ('insurance'),
  ('other')
on conflict do nothing;

-- 4) Also ensure any categories already present on existing costs rows
--    are registered (so dropdown shows them).
insert into public.cost_categories (name)
select distinct c.category from public.costs c
where c.category is not null
on conflict do nothing;
