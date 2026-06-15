-- =============================================================================
-- Migration 018: generate rent + service-charge rows 6 months ahead
-- =============================================================================
-- Previously: current month + next 2 months.
-- Now:        current month + next 6 months for both rent and service charges.
-- Backfill function also extends forward, capped at the lease end_date.
-- =============================================================================

-- Rent generator: current month → current + 6 months
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
  v_end   := (date_trunc('month', current_date) + interval '6 month')::date;

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
      v_deduction := case
        when r.sc_payment_mode = 'lessee_direct' then 0
        else coalesce(r.service_charge_monthly, 0)
      end;
      v_net := r.gross_rent_monthly - v_deduction;

      insert into public.rent_collections
        (lease_id, property_id, due_month, due_date, gross_amount,
         service_charge_deduction, net_amount, status, collected_amount)
      values
        (r.lease_id, r.property_id, v_month, v_due_date, r.gross_rent_monthly,
         v_deduction, v_net, 'due', 0)
      on conflict (lease_id, due_month) do nothing;
      if found then v_inserted := v_inserted + 1; end if;
    end loop;
  end loop;
  return v_inserted;
end; $$;

-- Service-charge generator: same 6-month forward window
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
  v_end   := (date_trunc('month', current_date) + interval '6 month')::date;

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

-- Backfill per-lease: from lease start (or beyond) through current + 6 months,
-- capped at the lease end_date. Idempotent — won't re-create existing rows.
create or replace function public.backfill_lease_rents(p_lease_id uuid)
returns int language plpgsql as $$
declare
  v_inserted int := 0;
  l record;
  v_month date;
  v_due_date date;
  v_deduction numeric(14,2);
  v_net numeric(14,2);
  v_first_month date;
  v_last_month date;
begin
  select le.id, le.property_id, le.start_date, le.end_date,
         le.gross_rent_monthly, le.sc_payment_mode,
         p.service_charge_monthly
  into l
  from public.leases le
  join public.properties p on p.id = le.property_id
  where le.id = p_lease_id;

  if l is null or l.id is null then
    raise exception 'Lease % not found', p_lease_id;
  end if;

  v_first_month := date_trunc('month', l.start_date)::date;
  v_last_month  := least(
    date_trunc('month', coalesce(l.end_date, current_date))::date,
    (date_trunc('month', current_date) + interval '6 month')::date
  );

  for v_month in
    select gs::date
    from generate_series(v_first_month, v_last_month, '1 month'::interval) gs
  loop
    v_due_date := public.rent_due_date_for(l.start_date, v_month);
    v_deduction := case
      when l.sc_payment_mode = 'lessee_direct' then 0
      else coalesce(l.service_charge_monthly, 0)
    end;
    v_net := l.gross_rent_monthly - v_deduction;

    insert into public.rent_collections
      (lease_id, property_id, due_month, due_date, gross_amount,
       service_charge_deduction, net_amount, status, collected_amount)
    values
      (l.id, l.property_id, v_month, v_due_date, l.gross_rent_monthly,
       v_deduction, v_net, 'due', 0)
    on conflict (lease_id, due_month) do nothing;
    if found then v_inserted := v_inserted + 1; end if;
  end loop;

  return v_inserted;
end; $$;

-- Run the worker once now so the new horizon fills in immediately
select public.daily_worker();
