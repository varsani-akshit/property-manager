-- =============================================================================
-- Migration 011: a cost can have multiple categorized line items
-- =============================================================================
-- Before: costs.category + costs.amount = a single value per entry.
-- After:  one costs row can have N line items, each with its own category + amount.
--         costs.amount stays as the running total (denormalized, app-maintained).
--
-- Property allocations remain at the cost level — the total is split by sqft
-- across the chosen properties, just like before.
-- =============================================================================

create table if not exists public.cost_line_items (
  id uuid primary key default gen_random_uuid(),
  cost_id uuid not null references public.costs(id) on delete cascade,
  category text not null,
  amount numeric(14,2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_cli_cost on public.cost_line_items(cost_id);
create index if not exists idx_cli_category on public.cost_line_items(category);

alter table public.cost_line_items enable row level security;
drop policy if exists cli_rw on public.cost_line_items;
create policy cli_rw on public.cost_line_items
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- Backfill: existing single-line costs → one line item per row.
insert into public.cost_line_items (cost_id, category, amount)
select c.id, c.category, c.amount
from public.costs c
left join public.cost_line_items cli on cli.cost_id = c.id
where cli.id is null;

-- costs.category becomes legacy/optional: it's now the FIRST line item's category.
-- We keep the column non-null but don't require app code to use it — keep in sync as line items change.
