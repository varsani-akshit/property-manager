-- ============================================================================
-- Rental Management Schema
-- Currency: KES. Dates stored as DATE (display dd/mm/yyyy in UI).
-- All money fields use NUMERIC(14,2) — exact decimals, no float drift.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- User profiles with granular permission flags (no fixed roles).
-- One row per auth.users entry; created via trigger on signup.
-- ---------------------------------------------------------------------------
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  is_admin boolean not null default false,
  -- granular permissions
  can_create_property boolean not null default false,
  can_edit_property boolean not null default false,
  can_delete_property boolean not null default false,
  can_create_lease boolean not null default false,
  can_cancel_lease boolean not null default false,
  can_mark_rent boolean not null default false,
  can_add_cost boolean not null default false,
  can_delete_cost boolean not null default false,
  can_manage_users boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Compounds: top-level grouping (e.g. "Sunrise Apartments, Westlands")
-- ---------------------------------------------------------------------------
create table if not exists public.compounds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- ---------------------------------------------------------------------------
-- Properties
-- service_charge_monthly: KES cost to the company every month
-- service_charge_start_date: when service charge starts accruing
-- ---------------------------------------------------------------------------
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  compound_id uuid not null references public.compounds(id) on delete restrict,
  name text not null,
  area_sqft numeric(12,2) not null check (area_sqft > 0),
  valuation numeric(14,2) not null default 0 check (valuation >= 0),
  service_charge_monthly numeric(14,2) not null default 0 check (service_charge_monthly >= 0),
  service_charge_start_date date,
  deed_url text,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists idx_properties_compound on public.properties(compound_id);
create index if not exists idx_properties_archived on public.properties(archived);

-- ---------------------------------------------------------------------------
-- Leases
-- gross_rent_monthly: what lessee pays (inclusive of tax)
-- lessee_pays_service_charge: if true, our net income = gross - service_charge
--                              (we still post service charge as a company cost;
--                               UI will display net rent to user)
-- ---------------------------------------------------------------------------
create table if not exists public.leases (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  lessee_name text not null,
  lessee_contact text not null,
  lessee_doc_url text,
  start_date date not null,
  end_date date not null,
  gross_rent_monthly numeric(14,2) not null check (gross_rent_monthly >= 0),
  lessee_pays_service_charge boolean not null default false,
  active boolean not null default true,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  check (end_date >= start_date)
);

create index if not exists idx_leases_property on public.leases(property_id);
create index if not exists idx_leases_active on public.leases(active);

-- Enforce: at most one active lease per property
create unique index if not exists uniq_active_lease_per_property
  on public.leases(property_id) where active = true;

-- ---------------------------------------------------------------------------
-- Rent collections: one row per (lease, due_month)
-- Auto-generated by generate_due_rents() per active lease.
-- net_amount = gross_rent - (service_charge if lessee_pays_service_charge else 0)
-- ---------------------------------------------------------------------------
create table if not exists public.rent_collections (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references public.leases(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  due_month date not null, -- first day of month
  gross_amount numeric(14,2) not null,
  service_charge_deduction numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null,
  status text not null default 'due' check (status in ('due','collected','overdue','waived')),
  collected_at timestamptz,
  collected_by uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now(),
  unique (lease_id, due_month)
);

create index if not exists idx_rent_status on public.rent_collections(status);
create index if not exists idx_rent_due_month on public.rent_collections(due_month);
create index if not exists idx_rent_property on public.rent_collections(property_id);

-- ---------------------------------------------------------------------------
-- Costs
-- A cost row is the "expense event". If multiple properties share it,
-- cost_allocations holds the per-property split (weighted by sqft).
-- For single-property costs we still create one allocation row for query symmetry.
-- ---------------------------------------------------------------------------
create table if not exists public.costs (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  category text not null default 'general'
    check (category in ('general','maintenance','utilities','tax','service_charge','insurance','other')),
  amount numeric(14,2) not null check (amount >= 0),
  incurred_on date not null,
  is_auto_service_charge boolean not null default false, -- system-generated monthly SC
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists idx_costs_incurred on public.costs(incurred_on);
create index if not exists idx_costs_category on public.costs(category);

create table if not exists public.cost_allocations (
  id uuid primary key default gen_random_uuid(),
  cost_id uuid not null references public.costs(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  allocated_amount numeric(14,2) not null check (allocated_amount >= 0),
  created_at timestamptz not null default now(),
  unique (cost_id, property_id)
);

create index if not exists idx_alloc_property on public.cost_allocations(property_id);
create index if not exists idx_alloc_cost on public.cost_allocations(cost_id);

-- ---------------------------------------------------------------------------
-- Helper: split a cost across N properties weighted by sqft.
-- Uses largest-remainder rounding so allocations sum to exact `amount`.
-- ---------------------------------------------------------------------------
create or replace function public.allocate_cost_by_sqft(
  p_cost_id uuid,
  p_property_ids uuid[]
) returns void language plpgsql as $$
declare
  v_total_amount numeric(14,2);
  v_total_sqft numeric(14,2);
  v_running numeric(14,2) := 0;
  v_count int;
  v_i int := 0;
  r record;
  v_alloc numeric(14,2);
begin
  select amount into v_total_amount from public.costs where id = p_cost_id;
  select coalesce(sum(area_sqft), 0) into v_total_sqft
    from public.properties where id = any(p_property_ids);
  v_count := array_length(p_property_ids, 1);

  if v_total_sqft = 0 or v_count = 0 then
    raise exception 'cannot allocate: no properties or zero total sqft';
  end if;

  for r in
    select id, area_sqft
    from public.properties
    where id = any(p_property_ids)
    order by area_sqft desc, id
  loop
    v_i := v_i + 1;
    if v_i = v_count then
      v_alloc := v_total_amount - v_running; -- absorb rounding
    else
      v_alloc := round(v_total_amount * (r.area_sqft / v_total_sqft), 2);
      v_running := v_running + v_alloc;
    end if;
    insert into public.cost_allocations (cost_id, property_id, allocated_amount)
    values (p_cost_id, r.id, v_alloc);
  end loop;
end; $$;

-- ---------------------------------------------------------------------------
-- Generate due rent rows for all active leases for a given month.
-- Idempotent: on conflict do nothing.
-- ---------------------------------------------------------------------------
create or replace function public.generate_due_rents(p_month date default date_trunc('month', current_date)::date)
returns int language plpgsql as $$
declare
  v_count int := 0;
  r record;
  v_deduction numeric(14,2);
  v_net numeric(14,2);
begin
  for r in
    select l.id as lease_id, l.property_id, l.gross_rent_monthly, l.lessee_pays_service_charge,
           p.service_charge_monthly
    from public.leases l
    join public.properties p on p.id = l.property_id
    where l.active = true
      and l.start_date <= (p_month + interval '1 month - 1 day')::date
      and l.end_date >= p_month
  loop
    v_deduction := case when r.lessee_pays_service_charge then r.service_charge_monthly else 0 end;
    v_net := r.gross_rent_monthly - v_deduction;
    insert into public.rent_collections
      (lease_id, property_id, due_month, gross_amount, service_charge_deduction, net_amount, status)
    values
      (r.lease_id, r.property_id, p_month, r.gross_rent_monthly, v_deduction, v_net, 'due')
    on conflict (lease_id, due_month) do nothing;
    if found then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end; $$;

-- ---------------------------------------------------------------------------
-- Post monthly service charges as costs (one cost per property per month).
-- Idempotent via (is_auto_service_charge, description) uniqueness check.
-- ---------------------------------------------------------------------------
create or replace function public.post_monthly_service_charges(p_month date default date_trunc('month', current_date)::date)
returns int language plpgsql as $$
declare
  v_count int := 0;
  r record;
  v_cost_id uuid;
  v_desc text;
begin
  for r in
    select id, name, service_charge_monthly, service_charge_start_date
    from public.properties
    where archived = false
      and service_charge_monthly > 0
      and (service_charge_start_date is null or service_charge_start_date <= (p_month + interval '1 month - 1 day')::date)
  loop
    v_desc := 'Service charge ' || to_char(p_month, 'YYYY-MM') || ' — ' || r.name;
    if exists (select 1 from public.costs where is_auto_service_charge and description = v_desc) then
      continue;
    end if;
    insert into public.costs (description, category, amount, incurred_on, is_auto_service_charge)
    values (v_desc, 'service_charge', r.service_charge_monthly, p_month, true)
    returning id into v_cost_id;
    insert into public.cost_allocations (cost_id, property_id, allocated_amount)
    values (v_cost_id, r.id, r.service_charge_monthly);
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;

-- ---------------------------------------------------------------------------
-- Convenience view: per-property summary
-- ---------------------------------------------------------------------------
create or replace view public.v_property_summary as
select
  p.id,
  p.compound_id,
  p.name,
  p.area_sqft,
  p.valuation,
  p.service_charge_monthly,
  p.archived,
  (select count(*) from public.leases l where l.property_id = p.id and l.active) as active_lease_count,
  (select gross_rent_monthly from public.leases l where l.property_id = p.id and l.active limit 1) as current_gross_rent,
  coalesce((select sum(rc.net_amount) from public.rent_collections rc where rc.property_id = p.id and rc.status = 'collected'), 0) as total_rent_collected,
  coalesce((select sum(rc.net_amount) from public.rent_collections rc where rc.property_id = p.id and rc.status = 'due'), 0) as total_rent_due,
  coalesce((select sum(ca.allocated_amount) from public.cost_allocations ca where ca.property_id = p.id), 0) as total_costs
from public.properties p;

-- ---------------------------------------------------------------------------
-- RLS: enabled, but all authenticated users can read.
-- Writes are guarded at the application layer using permission flags.
-- ---------------------------------------------------------------------------
alter table public.user_profiles enable row level security;
alter table public.compounds enable row level security;
alter table public.properties enable row level security;
alter table public.leases enable row level security;
alter table public.rent_collections enable row level security;
alter table public.costs enable row level security;
alter table public.cost_allocations enable row level security;

do $$ begin
  -- profiles: users can read their own + admins read all
  drop policy if exists profiles_select on public.user_profiles;
  create policy profiles_select on public.user_profiles for select
    using (auth.uid() = id or exists (select 1 from public.user_profiles up where up.id = auth.uid() and up.is_admin));
  drop policy if exists profiles_update on public.user_profiles;
  create policy profiles_update on public.user_profiles for update
    using (exists (select 1 from public.user_profiles up where up.id = auth.uid() and up.is_admin))
    with check (exists (select 1 from public.user_profiles up where up.id = auth.uid() and up.is_admin));

  -- generic read-all for app data
  drop policy if exists compounds_rw on public.compounds;
  create policy compounds_rw on public.compounds for all using (auth.uid() is not null) with check (auth.uid() is not null);
  drop policy if exists properties_rw on public.properties;
  create policy properties_rw on public.properties for all using (auth.uid() is not null) with check (auth.uid() is not null);
  drop policy if exists leases_rw on public.leases;
  create policy leases_rw on public.leases for all using (auth.uid() is not null) with check (auth.uid() is not null);
  drop policy if exists rent_rw on public.rent_collections;
  create policy rent_rw on public.rent_collections for all using (auth.uid() is not null) with check (auth.uid() is not null);
  drop policy if exists costs_rw on public.costs;
  create policy costs_rw on public.costs for all using (auth.uid() is not null) with check (auth.uid() is not null);
  drop policy if exists alloc_rw on public.cost_allocations;
  create policy alloc_rw on public.cost_allocations for all using (auth.uid() is not null) with check (auth.uid() is not null);
end $$;
