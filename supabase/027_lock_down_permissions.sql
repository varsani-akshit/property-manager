-- 027: enforce the app's permissions in the database.
--
-- Until now every table allowed any signed-in user to read AND write anything
-- (policies were just `auth.uid() is not null`), so the per-user permission
-- flags were only enforced by the app's own server code. Anyone with a login
-- could bypass them by calling the Supabase API directly. Worse, the three
-- summary views ran as their owner with no RLS and were readable by `anon` —
-- i.e. anyone holding the public browser key could read valuations and rents
-- without signing in.
--
-- After this migration:
--   * anon (not signed in) can read and call nothing in `public`.
--   * Signed-in users can still READ everything (the app's pages join across
--     tables; which pages a user sees is still decided by the view_* flags).
--   * WRITES require the same permission the app checks for that action
--     (public.has_perm). Admins have every permission.
--   * Money moves only through record_payment / set_collected_total, which now
--     run with elevated rights and check permissions themselves — so someone
--     who may record rent can't use that to edit leases or costs.
--   * The service-role key (server only: MCP, dashboard cache) and the nightly
--     job are unaffected; the app checks permissions before using them.
--
-- Run once:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/027_lock_down_permissions.sql

-- ─── Helpers ────────────────────────────────────────────────────────────────

-- Does the signed-in user hold permission `p` (e.g. 'mark_rent' → can_mark_rent)?
-- Admins hold every permission.
create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select u.is_admin or coalesce((to_jsonb(u) ->> ('can_' || p))::boolean, false)
    from public.user_profiles u
    where u.id = auth.uid()
  ), false);
$$;

-- Server-side callers that bypass RLS anyway: the service-role key and direct
-- database sessions (migrations, pg_cron). Never true for anon / signed-in users.
create or replace function public.is_trusted_caller() returns boolean
language plpgsql stable set search_path = public as $$
declare role text;
begin
  begin
    role := nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role';
  exception when others then role := null;
  end;
  if role = 'service_role' then return true; end if;
  return role is null and session_user in ('postgres', 'supabase_admin');
end $$;

-- ─── Views: run as the caller, no anonymous access ──────────────────────────

alter view public.v_property_summary set (security_invoker = true);
alter view public.v_rent_rows_by_property set (security_invoker = true);
alter view public.v_sc_status_totals set (security_invoker = true);

-- ─── No anonymous access to anything in public ──────────────────────────────

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- Views are read-only for signed-in users.
revoke insert, update, delete, truncate on public.v_property_summary, public.v_rent_rows_by_property, public.v_sc_status_totals from authenticated;

-- Functions the app calls as a signed-in user. Trigger functions and the
-- monthly generators need no grant (triggers / definer callers run them).
grant execute on function
  public.has_perm(text), public.is_trusted_caller(), public.is_user_manager(), public.current_actor(),
  public.dashboard_snapshot(date, date), public.rent_bucket(text, date), public.rent_due_date_for(date, date),
  public.record_payment(text, uuid, numeric, date, text, text, text),
  public.set_collected_total(text, uuid, numeric, date, text, text, text),
  public.backfill_lease_rents(uuid), public.daily_worker(), public.allocate_cost_by_sqft(uuid, uuid[])
to authenticated, service_role;
revoke execute on function public.generate_due_rents(date), public.generate_due_rents_advance(),
  public.generate_service_charges_advance(), public.post_monthly_service_charges(date) from authenticated;

-- ─── Write policies, table by table ─────────────────────────────────────────
-- Each table: signed-in users may SELECT; INSERT/UPDATE/DELETE need the
-- permission the app checks for that action.

do $$
declare
  t text;
begin
  -- drop the old catch-all policies
  for t in select unnest(array['compounds_rw:compounds', 'properties_rw:properties', 'leases_rw:leases',
    'rent_rw:rent_collections', 'costs_rw:costs', 'cli_rw:cost_line_items', 'alloc_rw:cost_allocations',
    'cost_categories_rw:cost_categories', 'rent_changes_rw:lease_rent_changes',
    'service_charges_rw:service_charges', 'reminders_rw:reminders', 'payments_insert:payments'])
  loop
    execute format('drop policy if exists %I on public.%I', split_part(t, ':', 1), split_part(t, ':', 2));
  end loop;

  -- read access for signed-in users (re-created idempotently)
  foreach t in array array['compounds', 'properties', 'leases', 'rent_collections', 'costs', 'cost_line_items',
    'cost_allocations', 'cost_categories', 'lease_rent_changes', 'service_charges', 'reminders']
  loop
    execute format('drop policy if exists %1$s_read on public.%1$I', t);
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (true)', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
  end loop;
end $$;

-- Compounds: create / edit / delete property permissions
create policy compounds_insert on public.compounds for insert to authenticated with check (has_perm('create_property'));
create policy compounds_update on public.compounds for update to authenticated using (has_perm('edit_property')) with check (has_perm('edit_property'));
create policy compounds_delete on public.compounds for delete to authenticated using (has_perm('delete_property'));

-- Properties (archiving is an update by someone who may delete)
create policy properties_insert on public.properties for insert to authenticated with check (has_perm('create_property'));
create policy properties_update on public.properties for update to authenticated
  using (has_perm('edit_property') or has_perm('delete_property')) with check (has_perm('edit_property') or has_perm('delete_property'));
create policy properties_delete on public.properties for delete to authenticated using (has_perm('delete_property'));

-- Leases: put on rent / edit / raise rent = create_lease; cancel = cancel_lease
create policy leases_insert on public.leases for insert to authenticated with check (has_perm('create_lease'));
create policy leases_update on public.leases for update to authenticated
  using (has_perm('create_lease') or has_perm('cancel_lease')) with check (has_perm('create_lease') or has_perm('cancel_lease'));

create policy lease_rent_changes_insert on public.lease_rent_changes for insert to authenticated with check (has_perm('create_lease'));

-- Rent rows: generated with a lease; amounts edited by rent markers or lease editors;
-- future unpaid rows removed when a lease is cancelled. (Collections go through record_payment.)
create policy rent_collections_insert on public.rent_collections for insert to authenticated with check (has_perm('create_lease'));
create policy rent_collections_update on public.rent_collections for update to authenticated
  using (has_perm('mark_rent') or has_perm('create_lease')) with check (has_perm('mark_rent') or has_perm('create_lease'));
create policy rent_collections_delete on public.rent_collections for delete to authenticated
  using (has_perm('cancel_lease') and collected_amount = 0);

-- Costs: add / edit = add_cost (service-charge payments also create a cost); delete = delete_cost
create policy costs_insert on public.costs for insert to authenticated with check (has_perm('add_cost') or has_perm('pay_service_charges'));
create policy costs_update on public.costs for update to authenticated using (has_perm('add_cost')) with check (has_perm('add_cost'));
create policy costs_delete on public.costs for delete to authenticated using (has_perm('delete_cost'));

create policy cost_line_items_insert on public.cost_line_items for insert to authenticated with check (has_perm('add_cost'));
create policy cost_line_items_update on public.cost_line_items for update to authenticated using (has_perm('add_cost')) with check (has_perm('add_cost'));
create policy cost_line_items_delete on public.cost_line_items for delete to authenticated using (has_perm('add_cost') or has_perm('delete_cost'));

create policy cost_allocations_insert on public.cost_allocations for insert to authenticated with check (has_perm('add_cost') or has_perm('pay_service_charges'));
create policy cost_allocations_update on public.cost_allocations for update to authenticated using (has_perm('add_cost')) with check (has_perm('add_cost'));
create policy cost_allocations_delete on public.cost_allocations for delete to authenticated using (has_perm('add_cost') or has_perm('delete_cost'));

create policy cost_categories_insert on public.cost_categories for insert to authenticated with check (has_perm('add_cost'));
create policy cost_categories_update on public.cost_categories for update to authenticated using (has_perm('add_cost')) with check (has_perm('add_cost'));

-- Service charges: paid / skipped by pay_service_charges; status follows leases
-- (create_lease, cancel_lease); amounts follow the property (edit_property).
create policy service_charges_insert on public.service_charges for insert to authenticated with check (has_perm('create_lease'));
create policy service_charges_update on public.service_charges for update to authenticated
  using (has_perm('pay_service_charges') or has_perm('create_lease') or has_perm('cancel_lease') or has_perm('edit_property'))
  with check (has_perm('pay_service_charges') or has_perm('create_lease') or has_perm('cancel_lease') or has_perm('edit_property'));
create policy service_charges_delete on public.service_charges for delete to authenticated using (has_perm('edit_property'));

-- Reminders: logged by whoever may chase rent; the log is append-only.
create policy reminders_insert on public.reminders for insert to authenticated with check (has_perm('mark_rent') and sent_by = auth.uid());

-- Payments: no direct inserts — only via record_payment (below). Read stays open.

-- ─── Money functions: elevated, with their own permission check ─────────────

-- Who may move money of each kind: recording rent = mark_rent; a deposit taken
-- when the lease is created/edited = create_lease; reversing a charge that's
-- edited off a lessee = add_cost.
create or replace function public.can_record_payment(p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_trusted_caller()
      or public.has_perm('mark_rent')
      or (p_kind = 'deposit' and public.has_perm('create_lease'))
      or (p_kind = 'cost' and public.has_perm('add_cost'));
$$;
grant execute on function public.can_record_payment(text) to authenticated, service_role;

do $$
begin
  -- Re-create record_payment / set_collected_total as SECURITY DEFINER with a
  -- permission guard at the top, keeping their bodies from 024.
  execute regexp_replace(
    pg_get_functiondef('public.record_payment(text, uuid, numeric, date, text, text, text)'::regprocedure),
    'LANGUAGE plpgsql\s*\n\s*SET search_path TO ''public''\s*\nAS \$function\$\s*\ndeclare',
    E'LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public''\nAS $function$\ndeclare'
  );
  execute regexp_replace(
    pg_get_functiondef('public.set_collected_total(text, uuid, numeric, date, text, text, text)'::regprocedure),
    'LANGUAGE plpgsql\s*\n\s*SET search_path TO ''public''\s*\nAS \$function\$\s*\ndeclare',
    E'LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public''\nAS $function$\ndeclare'
  );
end $$;

-- The guard itself: injected as the first statement of each body.
create or replace function public._guard_payment(p_kind text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_record_payment(p_kind) then
    raise exception 'Permission denied: you may not record % payments', p_kind using errcode = '42501';
  end if;
end $$;

do $$
declare src text;
begin
  foreach src in array array[
    'public.record_payment(text, uuid, numeric, date, text, text, text)',
    'public.set_collected_total(text, uuid, numeric, date, text, text, text)'
  ] loop
    execute regexp_replace(
      pg_get_functiondef(src::regprocedure),
      '\nbegin\n',
      E'\nbegin\n  perform public._guard_payment(p_kind);\n'
    );
  end loop;
end $$;

-- ─── Rent generation: elevated, for lease editors and the nightly job ───────

do $$
begin
  execute regexp_replace(
    pg_get_functiondef('public.backfill_lease_rents(uuid)'::regprocedure),
    'LANGUAGE plpgsql',
    'LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'''
  );
  execute regexp_replace(
    pg_get_functiondef('public.daily_worker()'::regprocedure),
    'LANGUAGE plpgsql',
    'LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'''
  );
end $$;

create or replace function public._guard_lease_editor() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_trusted_caller() or public.has_perm('create_lease')) then
    raise exception 'Permission denied: you may not generate rent rows' using errcode = '42501';
  end if;
end $$;

do $$
declare src text;
begin
  foreach src in array array['public.backfill_lease_rents(uuid)', 'public.daily_worker()'] loop
    execute regexp_replace(pg_get_functiondef(src::regprocedure), '\nbegin\n', E'\nbegin\n  perform public._guard_lease_editor();\n');
  end loop;
end $$;

revoke execute on function public._guard_payment(text), public._guard_lease_editor() from public, anon;
grant execute on function public._guard_payment(text), public._guard_lease_editor() to authenticated, service_role;
