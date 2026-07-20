-- =============================================================================
-- Migration 023: dashboard_snapshot RPC
-- =============================================================================
-- Collapses the dashboard's 8 parallel queries into ONE round-trip.
-- Returns a JSON blob the page can destructure directly.
-- =============================================================================

drop function if exists public.dashboard_snapshot(date, date);
create or replace function public.dashboard_snapshot(p_from date, p_to date)
returns json language plpgsql stable security invoker as $$
declare
  v_today date := current_date;
  v_h30   date := v_today + 30;
  v_h60   date := v_today + 60;
  v_h90   date := v_today + 90;
  v_result json;
begin
  select json_build_object(
    -- Collected in period
    'collected', coalesce((
      select json_agg(json_build_object(
        'net_amount', net_amount,
        'collected_at', collected_at,
        'due_date', due_date,
        'property_id', property_id,
        'lease_id', lease_id
      ))
      from public.rent_collections
      where status = 'collected'
        and collected_at >= (p_from || 'T00:00:00Z')::timestamptz
        and collected_at <= (p_to   || 'T23:59:59Z')::timestamptz
    ), '[]'::json),

    -- Rent due in period (all statuses within the window)
    'dueInPeriod', coalesce((
      select json_agg(json_build_object(
        'net_amount', net_amount,
        'status', status
      ))
      from public.rent_collections
      where due_date between p_from and p_to
    ), '[]'::json),

    -- Overdue totals, aggregated per lessee in SQL. Only top 10 (by amount)
    -- travel back — dashboard just shows the leaderboard.
    'overdueByLessee', coalesce((
      select json_agg(row_to_json(o))
      from (
        select coalesce(l.lessee_name, '(unknown)') as lessee_name,
               sum(rc.net_amount)::numeric(14,2) as amount,
               count(*)::int as count,
               (v_today - min(rc.due_date))::int as oldest_days,
               array_agg(distinct p.name) filter (where p.name is not null) as properties
        from public.rent_collections rc
        left join public.properties p on p.id = rc.property_id
        left join public.leases l on l.id = rc.lease_id
        where rc.status in ('due', 'partial')
          and rc.due_date <= v_today
        group by l.lessee_name
        order by amount desc
        limit 10
      ) o
    ), '[]'::json),

    -- Aggregate outstanding totals (all rows, all lessees) for the KPI.
    'overdueTotals', (
      select json_build_object(
        'amount', coalesce(sum(net_amount), 0),
        'row_count', count(*)::int,
        'distinct_lessees', count(distinct lease_id)::int,
        'oldest_days', coalesce((v_today - min(due_date))::int, 0)
      )
      from public.rent_collections
      where status in ('due', 'partial') and due_date <= v_today
    ),

    -- Cost allocations in period (landlord-paid only)
    'costs', coalesce((
      select json_agg(json_build_object(
        'allocated_amount', ca.allocated_amount,
        'property_id', ca.property_id,
        'incurred_on', c.incurred_on,
        'category', c.category
      ))
      from public.cost_allocations ca
      join public.costs c on c.id = ca.cost_id
      where c.payable_by_lessee = false
        and c.incurred_on between p_from and p_to
    ), '[]'::json),

    -- Properties (active only)
    'properties', coalesce((
      select json_agg(json_build_object(
        'id', p.id,
        'name', p.name,
        'valuation', p.valuation,
        'compound_id', p.compound_id,
        'compound_name', c.name
      ))
      from public.properties p
      left join public.compounds c on c.id = p.compound_id
      where p.archived = false
    ), '[]'::json),

    -- Active leases
    'leases', coalesce((
      select json_agg(json_build_object(
        'id', id, 'lessee_name', lessee_name, 'property_id', property_id,
        'gross_rent_monthly', gross_rent_monthly, 'end_date', end_date, 'start_date', start_date
      ))
      from public.leases where active = true
    ), '[]'::json),

    -- Upcoming dues (next 90 days)
    'upcoming', coalesce((
      select json_agg(json_build_object('net_amount', net_amount, 'due_date', due_date))
      from public.rent_collections
      where status in ('due', 'partial')
        and due_date > v_today
        and due_date <= v_h90
    ), '[]'::json),

    -- Cost line items per category (landlord-paid) in period
    'costsByCategory', coalesce((
      select json_agg(json_build_object('category', li.category, 'amount', li.amount))
      from public.cost_line_items li
      join public.costs c on c.id = li.cost_id
      where c.payable_by_lessee = false
        and c.incurred_on between p_from and p_to
    ), '[]'::json)
  ) into v_result;
  return v_result;
end; $$;
