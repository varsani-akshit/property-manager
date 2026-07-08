-- =============================================================================
-- Migration 020: collect the full gross rent (stop netting the service charge)
-- =============================================================================
-- Previously: for we_pay leases, net_amount = gross_rent - service_charge.
-- The rent row's "net" was what we asked the tenant to pay us, and we owed
-- the SC to the provider separately.
--
-- Now: we always ask the tenant to pay the FULL gross rent. The service_charges
-- table continues to track what we owe the SC provider (unchanged). Rent rows
-- carry service_charge_deduction=0 and net_amount=gross_amount everywhere.
-- =============================================================================

-- Rent generator: no SC netting
create or replace function public.generate_due_rents_advance()
returns int language plpgsql as $$
declare
  v_inserted int := 0;
  r record;
  v_month date;
  v_due_date date;
  v_start date;
  v_end date;
begin
  v_start := date_trunc('month', current_date)::date;
  v_end   := (date_trunc('month', current_date) + interval '6 month')::date;

  for r in
    select l.id as lease_id, l.property_id, l.start_date, l.end_date,
           l.gross_rent_monthly
    from public.leases l
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

      insert into public.rent_collections
        (lease_id, property_id, due_month, due_date, gross_amount,
         service_charge_deduction, net_amount, status, collected_amount)
      values
        (r.lease_id, r.property_id, v_month, v_due_date, r.gross_rent_monthly,
         0, r.gross_rent_monthly, 'due', 0)
      on conflict (lease_id, due_month) do nothing;
      if found then v_inserted := v_inserted + 1; end if;
    end loop;
  end loop;
  return v_inserted;
end; $$;

-- Backfill: no SC netting
create or replace function public.backfill_lease_rents(p_lease_id uuid)
returns int language plpgsql as $$
declare
  v_inserted int := 0;
  l record;
  v_month date;
  v_due_date date;
  v_first_month date;
  v_last_month date;
begin
  select le.id, le.property_id, le.start_date, le.end_date, le.gross_rent_monthly
  into l
  from public.leases le
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

    insert into public.rent_collections
      (lease_id, property_id, due_month, due_date, gross_amount,
       service_charge_deduction, net_amount, status, collected_amount)
    values
      (l.id, l.property_id, v_month, v_due_date, l.gross_rent_monthly,
       0, l.gross_rent_monthly, 'due', 0)
    on conflict (lease_id, due_month) do nothing;
    if found then v_inserted := v_inserted + 1; end if;
  end loop;

  return v_inserted;
end; $$;

-- Un-net every UNPAID rent row so collections match the new policy.
-- Collected rows keep their historical values as an accurate record of
-- what actually flowed in.
update public.rent_collections
set net_amount = gross_amount,
    service_charge_deduction = 0
where status in ('due', 'partial')
  and (service_charge_deduction <> 0 or net_amount <> gross_amount);

-- Refill the horizon under the new rules.
select public.daily_worker();
