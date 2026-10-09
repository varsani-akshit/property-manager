-- 029: one compact fact feed for the interactive analytics dashboard.
--
-- The portfolio is small (hundreds of leases, a few thousand rent rows), so the
-- dashboard loads every fact once and slices it in the browser — every filter
-- and drill-down is instant. Rows are arrays (not objects) and reference
-- compounds / properties / leases / people by id, to keep the payload small.
--
-- Gated like dashboard_snapshot: view_dashboard (or a trusted server caller).
-- The app caches the result (lib/analytics/server.ts) until data changes.
--
-- Run once:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/029_analytics_facts.sql

create or replace function public.analytics_facts() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_trusted_caller() or public.has_perm('view_dashboard')) then
    raise exception 'Permission denied: dashboard' using errcode = '42501';
  end if;

  return json_build_object(
    'generatedAt', now(),

    -- [id, name]
    'compounds', coalesce((select json_agg(json_build_array(c.id, c.name) order by c.name) from compounds c), '[]'),

    -- [id, name, compound_id, sqft, valuation, service_charge_monthly, archived]
    'properties', coalesce((
      select json_agg(json_build_array(p.id, p.name, p.compound_id, p.area_sqft, p.valuation, p.service_charge_monthly, p.archived) order by p.name)
      from properties p
    ), '[]'),

    -- [id, property_id, lessee_name, start_date, end_date, rent_monthly, active, deposit_charged, deposit_collected, cancelled_on]
    'leases', coalesce((
      select json_agg(json_build_array(l.id, l.property_id, l.lessee_name, l.start_date, l.end_date, l.gross_rent_monthly,
                                       l.active, l.deposit_charged, l.deposit_collected, l.cancelled_at::date))
      from leases l
    ), '[]'),

    -- rent rows: [lease_id, due_date, net_amount, collected_amount]
    'rent', coalesce((
      select json_agg(json_build_array(r.lease_id, r.due_date, r.net_amount, r.collected_amount) order by r.due_date)
      from rent_collections r
      where r.status <> 'waived'
    ), '[]'),

    -- payments: [kind r|c|d, lease_id, paid_on, amount, method, recorded_by, due_date (rent/charge it paid, if any)]
    'payments', coalesce((
      select json_agg(json_build_array(left(p.kind, 1), p.lease_id, p.paid_on, p.amount, p.method, p.recorded_by,
                                       coalesce(r.due_date, c.due_date)) order by p.paid_on)
      from payments p
      left join rent_collections r on r.id = p.rent_collection_id
      left join costs c on c.id = p.cost_id
    ), '[]'),

    -- landlord costs, split by property and category: [property_id, incurred_on, category, amount]
    'costs', coalesce((
      select json_agg(json_build_array(a.property_id, c.incurred_on, coalesce(li.category, c.category),
                                       round(a.allocated_amount * coalesce(li.amount / nullif(c.amount, 0), 1), 2)))
      from cost_allocations a
      join costs c on c.id = a.cost_id and not c.payable_by_lessee
      left join cost_line_items li on li.cost_id = c.id
    ), '[]'),

    -- charges billed to lessees: [lease_id, due_date, category, amount, collected]
    'charges', coalesce((
      select json_agg(json_build_array(c.lease_id, coalesce(c.due_date, c.incurred_on), c.category, c.amount, c.collected_amount))
      from costs c
      where c.payable_by_lessee and c.lease_id is not null
    ), '[]'),

    -- service charges owed to compound managements: [property_id, due_month, amount, status]
    'serviceCharges', coalesce((
      select json_agg(json_build_array(s.property_id, s.due_month, s.amount, s.status))
      from service_charges s
    ), '[]'),

    -- staff who record payments: [id, name]
    'people', coalesce((select json_agg(json_build_array(u.id, coalesce(u.full_name, u.email))) from user_profiles u), '[]')
  );
end $$;

revoke execute on function public.analytics_facts() from public, anon;
grant execute on function public.analytics_facts() to authenticated, service_role;
