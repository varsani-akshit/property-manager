-- =============================================================================
-- Migration 002: view permissions, monthly cron, status helper
-- =============================================================================

-- 1) View permissions: per-page visibility flags.
--    Defaults: existing users see only Dashboard. Admins see everything (in app code).
alter table public.user_profiles
  add column if not exists can_view_dashboard  boolean not null default true,
  add column if not exists can_view_compounds  boolean not null default false,
  add column if not exists can_view_properties boolean not null default false,
  add column if not exists can_view_leases     boolean not null default false,
  add column if not exists can_view_rent       boolean not null default false,
  add column if not exists can_view_costs      boolean not null default false;

-- 2) pg_cron — schedule monthly rent generation + service-charge posting.
--    Safe to re-run: unschedule first, then re-create.
create extension if not exists pg_cron;

do $$ begin
  -- Drop existing schedules if present (ignore errors when job doesn't exist).
  perform cron.unschedule('generate-due-rents');
exception when others then null; end $$;

do $$ begin
  perform cron.unschedule('post-monthly-sc');
exception when others then null; end $$;

-- Run at 00:05 / 00:06 UTC on day 1 of each month.
select cron.schedule(
  'generate-due-rents',
  '5 0 1 * *',
  $$ select public.generate_due_rents(); $$
);

select cron.schedule(
  'post-monthly-sc',
  '6 0 1 * *',
  $$ select public.post_monthly_service_charges(); $$
);

-- 3) Helper: compute effective bucket for a rent row.
--    Returns one of: 'collected' | 'overdue' | 'due_soon'
create or replace function public.rent_bucket(p_status text, p_due_month date)
returns text language sql immutable as $$
  select case
    when p_status = 'collected' then 'collected'
    when p_status = 'waived'    then 'waived'
    when p_due_month < date_trunc('month', current_date)::date then 'overdue'
    else 'due_soon'
  end;
$$;
