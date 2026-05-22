-- =============================================================================
-- Migration 008: manual service-charge workflow + 3-mode lease SC handling
-- =============================================================================
-- Changes:
--  * service_charges table tracks one row per property per month with a status
--    lifecycle (pending → paid | skipped | lessee_direct). Replaces the old
--    auto-posting of SCs into the costs table.
--  * leases.sc_payment_mode replaces the boolean flag:
--      'we_pay'         — we cover the SC; net rent = gross
--      'we_collect'     — net rent = gross - SC; we also pay the SC
--      'lessee_direct'  — lessee pays the SC directly to provider; no entry on our side
--  * Properties with service_charge_monthly = 0 are skipped entirely.
--  * Daily worker now keeps both rent and service_charges in sync.
-- =============================================================================

-- 1) sc_payment_mode column on leases
alter table public.leases
  add column if not exists sc_payment_mode text not null default 'we_pay'
  check (sc_payment_mode in ('we_pay', 'we_collect', 'lessee_direct'));

-- 1a) Backfill from the legacy boolean (true → we_collect, false → we_pay)
update public.leases
  set sc_payment_mode = case when lessee_pays_service_charge then 'we_collect' else 'we_pay' end
  where sc_payment_mode = 'we_pay';

-- 2) service_charges table
create table if not exists public.service_charges (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  due_month date not null,
  amount numeric(14,2) not null check (amount >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'skipped', 'lessee_direct')),
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  cost_id uuid references public.costs(id) on delete set null, -- when paid, we mint a cost row
  notes text,
  created_at timestamptz not null default now(),
  unique (property_id, due_month)
);

create index if not exists idx_sc_status on public.service_charges(status);
create index if not exists idx_sc_property on public.service_charges(property_id);
create index if not exists idx_sc_due_month on public.service_charges(due_month);

alter table public.service_charges enable row level security;
drop policy if exists service_charges_rw on public.service_charges;
create policy service_charges_rw on public.service_charges
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- 3) New permission flags
alter table public.user_profiles
  add column if not exists can_view_service_charges boolean not null default false,
  add column if not exists can_pay_service_charges boolean not null default false;

-- 4) Generator: ensure service_charges rows exist for current + next 2 months.
create or replace function public.generate_service_charges_advance()
returns int language plpgsql as $$
declare
  v_inserted int := 0;
  r record;
  v_month date;
  v_start date;
  v_end date;
  v_status text;
begin
  v_start := date_trunc('month', current_date)::date;
  v_end   := (date_trunc('month', current_date) + interval '2 month')::date;

  for r in
    select p.id as property_id, p.service_charge_monthly, p.service_charge_start_date,
           l.sc_payment_mode
    from public.properties p
    left join public.leases l on l.property_id = p.id and l.active = true
    where p.archived = false and p.service_charge_monthly > 0
  loop
    for v_month in
      select gs::date
      from generate_series(
        greatest(coalesce(r.service_charge_start_date, v_start), v_start),
        v_end,
        '1 month'::interval
      ) gs
    loop
      v_status := case
        when r.sc_payment_mode = 'lessee_direct' then 'lessee_direct'
        else 'pending'
      end;
      insert into public.service_charges (property_id, due_month, amount, status)
      values (r.property_id, v_month, r.service_charge_monthly, v_status)
      on conflict (property_id, due_month) do nothing;
      if found then v_inserted := v_inserted + 1; end if;
    end loop;
  end loop;
  return v_inserted;
end; $$;

-- 5) Updated rent generator that respects sc_payment_mode
create or replace function public.generate_due_rents_advance()
returns int language plpgsql as $$
declare
  v_inserted int := 0;
  r record;
  v_month date;
  v_due_date date;
  v_deduction numeric(14,2);
  v_net numeric(14,2);
  v_start date;
  v_end date;
begin
  v_start := date_trunc('month', current_date)::date;
  v_end   := (date_trunc('month', current_date) + interval '2 month')::date;

  for r in
    select l.id as lease_id, l.property_id, l.start_date, l.end_date,
           l.gross_rent_monthly, l.sc_payment_mode,
           p.service_charge_monthly
    from public.leases l
    join public.properties p on p.id = l.property_id
    where l.active = true
  loop
    for v_month in
      select gs::date
      from generate_series(
        greatest(date_trunc('month', r.start_date)::date, v_start),
        least(date_trunc('month', r.end_date)::date, v_end),
        '1 month'::interval
      ) gs
    loop
      v_due_date := public.rent_due_date_for(r.start_date, v_month);
      v_deduction := case when r.sc_payment_mode = 'we_collect' then r.service_charge_monthly else 0 end;
      v_net := r.gross_rent_monthly - v_deduction;

      insert into public.rent_collections
        (lease_id, property_id, due_month, due_date, gross_amount,
         service_charge_deduction, net_amount, status)
      values
        (r.lease_id, r.property_id, v_month, v_due_date, r.gross_rent_monthly,
         v_deduction, v_net, 'due')
      on conflict (lease_id, due_month) do nothing;
      if found then v_inserted := v_inserted + 1; end if;
    end loop;
  end loop;
  return v_inserted;
end; $$;

-- 6) Updated daily worker
create or replace function public.daily_worker()
returns text language plpgsql as $$
declare
  v_rents int;
  v_sc int;
begin
  v_rents := public.generate_due_rents_advance();
  v_sc    := public.generate_service_charges_advance();
  return format('rents=%s, service_charges=%s', v_rents, v_sc);
end; $$;

-- 7) Cleanup: delete legacy auto-generated SC cost rows (they'll be replaced
--    by service_charges entries, materialized as costs only when explicitly paid).
delete from public.costs where is_auto_service_charge = true;

-- 8) Run once now
select public.daily_worker();
