-- =============================================================================
-- Migration 009: collapse SC modes to 2 (we_pay / lessee_direct)
-- =============================================================================
-- New rule:
--   we_pay         → net rent = gross - sc; service_charges row stays 'pending'
--   lessee_direct  → net rent = gross; service_charges row marked 'lessee_direct'
-- Properties with service_charge_monthly = 0 generate no service_charges at all.
-- =============================================================================

-- 1) Switch the check constraint to 2-value
alter table public.leases drop constraint if exists leases_sc_payment_mode_check;

-- Map any leftover 'we_collect' (from migration 008) to 'we_pay' since they share behavior now.
update public.leases set sc_payment_mode = 'we_pay' where sc_payment_mode = 'we_collect';

alter table public.leases
  add constraint leases_sc_payment_mode_check
  check (sc_payment_mode in ('we_pay', 'lessee_direct'));

-- 2) New rent generator: deduction = sc unless lessee_direct
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
      v_deduction := case
        when r.sc_payment_mode = 'lessee_direct' then 0
        else coalesce(r.service_charge_monthly, 0)
      end;
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

-- 3) Sync existing FUTURE unpaid rent rows to the new math.
--    Past dues (overdue) and already-collected rows keep their original amounts.
update public.rent_collections rc
set service_charge_deduction = case when l.sc_payment_mode = 'lessee_direct' then 0 else coalesce(p.service_charge_monthly, 0) end,
    gross_amount = l.gross_rent_monthly,
    net_amount = l.gross_rent_monthly - case when l.sc_payment_mode = 'lessee_direct' then 0 else coalesce(p.service_charge_monthly, 0) end
from public.leases l, public.properties p
where rc.lease_id = l.id
  and l.property_id = p.id
  and l.active = true
  and rc.status = 'due'
  and rc.due_date > current_date;

-- 4) Run the worker so anything missing gets generated
select public.daily_worker();
