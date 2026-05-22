-- =============================================================================
-- Migration 003: per-lease calendar due dates + daily cron
-- =============================================================================
-- Behavior change:
--   * Each lease's rent is due on the same day-of-month as the lease start_date
--     (clamped to month length — day 31 → last day of February, etc.)
--   * Buckets are computed in real time from due_date vs today:
--       outstanding = due_date <= today AND status = 'due'
--       due_soon    = today < due_date <= today + 7 AND status = 'due'
--       collected   = status = 'collected'
--   * A single daily cron job keeps the future pipeline filled
--     (current month + next 2 months) and posts service-charge costs.
-- =============================================================================

-- 1) Add due_date column (the actual calendar date rent is due that month).
alter table public.rent_collections
  add column if not exists due_date date;

-- 2) Backfill existing rows: derive due_date from the lease's start_date day-of-month
--    clamped to the month length of due_month.
update public.rent_collections rc
set due_date = least(
  (rc.due_month + ((extract(day from l.start_date)::int - 1) || ' day')::interval)::date,
  (rc.due_month + interval '1 month - 1 day')::date
)
from public.leases l
where rc.lease_id = l.id and rc.due_date is null;

alter table public.rent_collections
  alter column due_date set not null;

create index if not exists idx_rent_due_date on public.rent_collections(due_date);

-- 3) Helper that computes the due_date for a given lease + month, clamped properly.
create or replace function public.rent_due_date_for(
  p_lease_start date,
  p_month_start date
) returns date language sql immutable as $$
  select least(
    (p_month_start + ((extract(day from p_lease_start)::int - 1) || ' day')::interval)::date,
    (p_month_start + interval '1 month - 1 day')::date
  );
$$;

-- 4) New generator: for each active lease, ensures rent_collections rows exist
--    from the greater of (lease start month, current month) through (current + 2 months)
--    but never past the lease end date. Idempotent — on conflict do nothing.
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
           l.gross_rent_monthly, l.lessee_pays_service_charge,
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
      v_deduction := case when r.lessee_pays_service_charge then r.service_charge_monthly else 0 end;
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

-- 5) Single daily worker: generate rent + post service charges. Both idempotent.
create or replace function public.daily_worker()
returns text language plpgsql as $$
declare
  v_rents int;
  v_charges int;
begin
  v_rents   := public.generate_due_rents_advance();
  v_charges := public.post_monthly_service_charges(date_trunc('month', current_date)::date);
  return format('rents=%s, service_charges=%s', v_rents, v_charges);
end; $$;

-- 6) Replace monthly schedules with a single daily one (02:00 UTC = 05:00 EAT).
do $$ begin perform cron.unschedule('generate-due-rents'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('post-monthly-sc');     exception when others then null; end $$;
do $$ begin perform cron.unschedule('daily-rent-worker');   exception when others then null; end $$;

select cron.schedule(
  'daily-rent-worker',
  '0 2 * * *',
  $$ select public.daily_worker(); $$
);

-- 7) Run once now so the change takes effect immediately for existing data.
select public.daily_worker();
