-- 028: reads follow permissions too.
--
-- 027 locked down writes but left every table readable by any signed-in user.
-- Now each table is readable only by people whose permissions include a page
-- that shows it (or who may write to it — an UPDATE/DELETE has to see the row).
-- Admins see everything. The service-role key (MCP, dashboard cache) and
-- database sessions are unaffected.
--
-- Every permission check is wrapped as `(select …)` so Postgres evaluates it
-- once per query rather than once per row.
--
-- User profiles: you see your own row; user managers see everyone. Other
-- people's names (for "recorded by" columns) come from the `people` view, which
-- exposes only id, name and email — not anyone's permission flags.
--
-- Run once:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/028_restrict_reads.sql

-- True if the signed-in user holds any of the permissions.
create or replace function public.has_any_perm(perms text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select u.is_admin or exists (
      select 1 from unnest(perms) p where coalesce((to_jsonb(u) ->> ('can_' || p))::boolean, false)
    )
    from public.user_profiles u
    where u.id = auth.uid()
  ), false);
$$;
revoke execute on function public.has_any_perm(text[]) from public, anon;
grant execute on function public.has_any_perm(text[]) to authenticated, service_role;

-- Who may read each table.
create or replace function public.can_read(tbl text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_perm(case tbl
    -- names that appear across most pages
    when 'compounds'          then array['view_compounds','view_properties','view_leases','view_rent','view_costs','view_service_charges','create_property','edit_property','delete_property']
    when 'properties'         then array['view_compounds','view_properties','view_leases','view_rent','view_costs','view_service_charges','create_property','edit_property','delete_property','create_lease','add_cost']
    when 'leases'             then array['view_compounds','view_properties','view_leases','view_rent','view_costs','create_lease','cancel_lease','mark_rent','add_cost']
    when 'lease_rent_changes' then array['view_leases','create_lease']
    when 'rent_collections'   then array['view_compounds','view_properties','view_leases','view_rent','mark_rent','create_lease','cancel_lease']
    when 'payments'           then array['view_leases','view_rent','mark_rent']
    when 'reminders'          then array['view_rent','mark_rent']
    when 'costs'              then array['view_compounds','view_properties','view_leases','view_rent','view_costs','add_cost','delete_cost','mark_rent','pay_service_charges']
    when 'cost_line_items'    then array['view_properties','view_leases','view_rent','view_costs','add_cost','delete_cost','mark_rent']
    when 'cost_allocations'   then array['view_compounds','view_properties','view_leases','view_costs','add_cost','delete_cost','pay_service_charges']
    when 'cost_categories'    then array['view_costs','add_cost']
    when 'service_charges'    then array['view_service_charges','pay_service_charges','edit_property','create_lease','cancel_lease']
    else array[]::text[]
  end);
$$;
revoke execute on function public.can_read(text) from public, anon;
grant execute on function public.can_read(text) to authenticated, service_role;

-- Read policies (replace the open ones from 027)
do $$
declare t text;
begin
  foreach t in array array['compounds', 'properties', 'leases', 'lease_rent_changes', 'rent_collections', 'payments',
    'reminders', 'costs', 'cost_line_items', 'cost_allocations', 'cost_categories', 'service_charges']
  loop
    execute format('drop policy if exists %1$s_read on public.%1$I', t);
    execute format('drop policy if exists payments_select on public.%1$I', t);
    execute format(
      'create policy %1$s_read on public.%1$I for select to authenticated using ((select public.can_read(%1$L)))',
      t
    );
  end loop;
end $$;

-- Write policies from 027, re-created with the once-per-query form.
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and policyname ~ '_(insert|update|delete)$'
      and (coalesce(qual, '') ~ 'has_perm\(' or coalesce(with_check, '') ~ 'has_perm\(')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    execute format(
      'create policy %I on %I.%I for %s to authenticated %s %s',
      r.policyname, r.schemaname, r.tablename, r.cmd,
      case when r.qual is not null then format('using (%s)', regexp_replace(r.qual, '(has_perm\([^)]*\))', '(select \1)', 'g')) else '' end,
      case when r.with_check is not null then format('with check (%s)', regexp_replace(r.with_check, '(has_perm\([^)]*\))', '(select \1)', 'g')) else '' end
    );
  end loop;
end $$;

-- ─── User profiles ──────────────────────────────────────────────────────────

drop policy if exists profiles_select on public.user_profiles;
create policy profiles_select on public.user_profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_user_manager()));

-- Names for "recorded by" / "sent by" columns, without permission flags.
create or replace view public.people with (security_barrier = true) as
  select id, full_name, email from public.user_profiles;
revoke all on public.people from public, anon;
grant select on public.people to authenticated, service_role;

-- ─── Dashboard: one figure set for anyone allowed to see the dashboard ──────
-- The snapshot aggregates across every table; run it as owner, gated by
-- view_dashboard, so a dashboard-only user still sees the whole portfolio.

do $$
begin
  execute regexp_replace(
    pg_get_functiondef('public.dashboard_snapshot(date, date)'::regprocedure),
    'LANGUAGE plpgsql\s*\n\s*STABLE',
    E'LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''public'''
  );
  execute regexp_replace(
    pg_get_functiondef('public.dashboard_snapshot(date, date)'::regprocedure),
    '\nbegin\n',
    E'\nbegin\n  if not (public.is_trusted_caller() or public.has_perm(''view_dashboard'')) then\n    raise exception ''Permission denied: dashboard'' using errcode = ''42501'';\n  end if;\n'
  );
end $$;
