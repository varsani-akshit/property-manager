-- =============================================================================
-- Migration 010: wipe legacy SC cost rows, backfill service_charges Jan→now
-- =============================================================================
-- Effect:
--   * Removes every cost row with category='service_charge' (these were the
--     old auto-posted ones; nothing was approved via the new workflow yet).
--   * Clears the service_charges table.
--   * Regenerates service_charges for every active property with SC > 0,
--     for every month from January 1 of the CURRENT year through this month.
--   * Status = 'lessee_direct' if any lease covers that month with
--     sc_payment_mode='lessee_direct'; otherwise 'pending'.
--   * Daily cron then keeps current + next 2 months in sync going forward.
-- =============================================================================

-- 1) Delete legacy SC costs + their allocations (FK cascade)
delete from public.costs where category = 'service_charge';

-- 2) Clean slate for service_charges
truncate table public.service_charges;

-- 3) Backfill January 1 (current year) → current month
do $$
declare
  v_property_id uuid;
  v_amount      numeric(14,2);
  v_start_month date;
  v_month       date;
  v_year_start  date;
  v_lessee_direct boolean;
begin
  v_year_start := make_date(extract(year from current_date)::int, 1, 1);

  for v_property_id, v_amount, v_start_month in
    select p.id,
           p.service_charge_monthly,
           greatest(coalesce(p.service_charge_start_date, v_year_start), v_year_start)
    from public.properties p
    where p.archived = false and p.service_charge_monthly > 0
  loop
    for v_month in
      select gs::date
      from generate_series(
        v_start_month,
        date_trunc('month', current_date)::date,
        '1 month'::interval
      ) gs
    loop
      -- Was there an active 'lessee_direct' lease covering this month?
      select exists (
        select 1 from public.leases l
        where l.property_id = v_property_id
          and l.sc_payment_mode = 'lessee_direct'
          and l.start_date <= (v_month + interval '1 month - 1 day')::date
          and l.end_date   >= v_month
      ) into v_lessee_direct;

      insert into public.service_charges (property_id, due_month, amount, status)
      values (
        v_property_id,
        v_month,
        v_amount,
        case when v_lessee_direct then 'lessee_direct' else 'pending' end
      )
      on conflict (property_id, due_month) do nothing;
    end loop;
  end loop;
end $$;

-- 4) Ensure future months (current + next 2) are populated too
select public.daily_worker();
