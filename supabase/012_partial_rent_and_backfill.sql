-- =============================================================================
-- Migration 012: partial rent payments + per-lease backfill function
-- =============================================================================
-- Changes:
--   * rent_collections.collected_amount — how much has been received so far.
--     For 'collected' rows it equals net_amount. For 'partial' rows it's the
--     amount paid (remaining = net_amount - collected_amount, still outstanding).
--   * 'partial' added to the status check.
--   * backfill_lease_rents(lease_id) — creates rent rows for every month from
--     the lease start to current month (idempotent), letting users add a lease
--     and then mark historical rents as collected.
-- =============================================================================

alter table public.rent_collections
  add column if not exists collected_amount numeric(14,2) not null default 0
    check (collected_amount >= 0);

-- Backfill: for already-collected rows, collected_amount equals net_amount
update public.rent_collections
   set collected_amount = net_amount
 where status = 'collected' and collected_amount = 0;

-- Widen the status check
alter table public.rent_collections drop constraint if exists rent_collections_status_check;
alter table public.rent_collections
  add constraint rent_collections_status_check
  check (status in ('due', 'collected', 'overdue', 'waived', 'partial'));

-- =============================================================================
-- Backfill function: create rent rows for every month a lease covers, from
-- the start_date through min(end_date, current_month). Idempotent.
-- =============================================================================
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
    date_trunc('month', current_date)::date
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
