-- 024: payment log, audit trail, reminder log, API keys (MCP), and a
-- privilege fix on user_profiles.
--
-- Additive only: new tables, functions and triggers. The one behavioural change
-- to existing data is that user_profiles can now only be updated by admins /
-- user managers (previously any signed-in user could edit any profile,
-- including granting themselves admin).
--
-- Run once:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/024_payments_audit_reminders_mcp.sql

-- ─── Helpers ────────────────────────────────────────────────────────────────

-- True when the signed-in user may manage users (admin or can_manage_users).
create or replace function public.is_user_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and (is_admin or can_manage_users)
  );
$$;

-- Who is acting: the signed-in user, or — for server-side calls made with the
-- service-role key (the MCP endpoint, background jobs) — the user named in the
-- x-actor-id request header. The header is ignored for every other role, so a
-- browser session cannot impersonate anyone.
create or replace function public.current_actor() returns uuid
language plpgsql stable set search_path = public as $$
declare
  a uuid := auth.uid();
  claims json;
  headers json;
begin
  if a is not null then return a; end if;
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::json;
  exception when others then claims := null; end;
  if coalesce(claims->>'role', '') <> 'service_role' then return null; end if;
  begin
    headers := nullif(current_setting('request.headers', true), '')::json;
    return nullif(headers->>'x-actor-id', '')::uuid;
  exception when others then return null; end;
end $$;

-- ─── user_profiles: close the self-promotion hole ───────────────────────────

drop policy if exists profiles_update on public.user_profiles;
create policy profiles_update on public.user_profiles for update
  using (public.is_user_manager()) with check (public.is_user_manager());

drop policy if exists profiles_insert on public.user_profiles;
create policy profiles_insert on public.user_profiles for insert
  with check (id = auth.uid() and not is_admin and not can_manage_users);

-- ─── Payment log ────────────────────────────────────────────────────────────
-- One row per money movement against a rent row, a lessee-billed cost, or a
-- lease deposit. The *_collected columns on those rows stay as running totals
-- and are only changed through record_payment / set_collected_total below.

create table if not exists public.payments (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('rent', 'cost', 'deposit')),
  rent_collection_id uuid references public.rent_collections(id) on delete cascade,
  cost_id            uuid references public.costs(id) on delete cascade,
  lease_id           uuid references public.leases(id) on delete set null,
  property_id        uuid references public.properties(id) on delete set null,
  amount             numeric(14,2) not null check (amount <> 0),
  paid_on            date not null default current_date,
  method             text not null default 'other'
                       check (method in ('mpesa', 'bank', 'cheque', 'cash', 'other', 'adjustment', 'opening')),
  reference          text,
  notes              text,
  recorded_by        uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  check ((kind = 'rent') = (rent_collection_id is not null)),
  check ((kind = 'cost') = (cost_id is not null))
);
create index if not exists idx_payments_rent on public.payments (rent_collection_id);
create index if not exists idx_payments_cost on public.payments (cost_id);
create index if not exists idx_payments_lease on public.payments (lease_id, paid_on);
create index if not exists idx_payments_paid_on on public.payments (paid_on desc);

alter table public.payments enable row level security;
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select using (auth.uid() is not null);
-- Inserts go through record_payment (security invoker), so signed-in users need insert.
-- No update/delete policy: the log is append-only; corrections are adjustment rows.
drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments for insert with check (auth.uid() is not null);

-- Opening entries: everything collected before the log existed, so each row's
-- history adds up to its collected total.
insert into public.payments (kind, rent_collection_id, lease_id, property_id, amount, paid_on, method, notes, recorded_by)
select 'rent', r.id, r.lease_id, r.property_id, r.collected_amount,
       coalesce(r.collected_at::date, r.due_date), 'opening', 'Recorded before the payment log', r.collected_by
from public.rent_collections r
where r.collected_amount > 0
  and not exists (select 1 from public.payments p where p.rent_collection_id = r.id);

insert into public.payments (kind, cost_id, lease_id, property_id, amount, paid_on, method, notes, recorded_by)
select 'cost', c.id, c.lease_id, l.property_id, c.collected_amount,
       coalesce(c.collected_at::date, c.due_date, c.incurred_on), 'opening', 'Recorded before the payment log', c.collected_by
from public.costs c
left join public.leases l on l.id = c.lease_id
where c.payable_by_lessee and c.collected_amount > 0
  and not exists (select 1 from public.payments p where p.cost_id = c.id);

insert into public.payments (kind, lease_id, property_id, amount, paid_on, method, notes)
select 'deposit', l.id, l.property_id, l.deposit_collected, l.start_date, 'opening', 'Recorded before the payment log'
from public.leases l
where l.deposit_collected > 0
  and not exists (select 1 from public.payments p where p.kind = 'deposit' and p.lease_id = l.id);

-- Record one payment (or, with a negative amount, a correction) and update the
-- running total and status on the target row, atomically.
--   p_kind 'rent'    → p_target = rent_collections.id
--   p_kind 'cost'    → p_target = costs.id (must be billed to a lessee)
--   p_kind 'deposit' → p_target = leases.id
create or replace function public.record_payment(
  p_kind text,
  p_target uuid,
  p_amount numeric,
  p_paid_on date default current_date,
  p_method text default 'other',
  p_reference text default null,
  p_notes text default null
) returns json
language plpgsql security invoker set search_path = public as $$
declare
  v_actor uuid := public.current_actor();
  v_lease uuid; v_prop uuid;
  v_due numeric; v_paid numeric; v_new numeric;
  v_status text;
  v_id uuid;
  v_on date := coalesce(p_paid_on, current_date);
begin
  if p_amount is null or p_amount = 0 then
    raise exception 'Amount must not be zero';
  end if;

  if p_kind = 'rent' then
    select lease_id, property_id, net_amount, collected_amount
      into v_lease, v_prop, v_due, v_paid
      from rent_collections where id = p_target for update;
    if not found then raise exception 'Rent row not found'; end if;
  elsif p_kind = 'cost' then
    select c.lease_id, l.property_id, c.amount, c.collected_amount
      into v_lease, v_prop, v_due, v_paid
      from costs c left join leases l on l.id = c.lease_id
      where c.id = p_target and c.payable_by_lessee for update of c;
    if not found then raise exception 'Lessee-billed cost not found'; end if;
  elsif p_kind = 'deposit' then
    select id, property_id, deposit_charged, deposit_collected
      into v_lease, v_prop, v_due, v_paid
      from leases where id = p_target for update;
    if not found then raise exception 'Lease not found'; end if;
  else
    raise exception 'Unknown payment kind %', p_kind;
  end if;

  v_new := round(v_paid + p_amount, 2);
  if v_new < 0 then
    raise exception 'That would take the collected total below zero (collected so far: %)', v_paid;
  end if;
  if p_kind <> 'deposit' and v_new > v_due then
    raise exception 'That is more than is owed (still due: %)', greatest(v_due - v_paid, 0);
  end if;

  v_status := case
    when v_due > 0 and v_new >= v_due then 'collected'
    when v_new > 0 then 'partial'
    else 'due'
  end;

  if p_kind = 'rent' then
    update rent_collections set
      collected_amount = v_new,
      status = v_status,
      collected_at = case when v_new > 0 then v_on::timestamptz else null end,
      collected_by = case when v_new > 0 then v_actor else null end
    where id = p_target;
  elsif p_kind = 'cost' then
    update costs set
      collected_amount = v_new,
      collection_status = v_status,
      collected_at = case when v_new > 0 then v_on::timestamptz else null end,
      collected_by = case when v_new > 0 then v_actor else null end
    where id = p_target;
  else
    update leases set deposit_collected = v_new where id = p_target;
  end if;

  insert into payments (kind, rent_collection_id, cost_id, lease_id, property_id, amount, paid_on, method, reference, notes, recorded_by)
  values (
    p_kind,
    case when p_kind = 'rent' then p_target end,
    case when p_kind = 'cost' then p_target end,
    v_lease, v_prop, p_amount, v_on,
    coalesce(nullif(p_method, ''), 'other'),
    nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), v_actor
  ) returning id into v_id;

  return json_build_object('payment_id', v_id, 'collected', v_new, 'due', v_due, 'status', v_status);
end $$;

-- Set the collected total to an exact figure (used by the edit forms): logs the
-- difference as a payment, or as an adjustment when it goes down.
create or replace function public.set_collected_total(
  p_kind text,
  p_target uuid,
  p_total numeric,
  p_paid_on date default current_date,
  p_method text default 'other',
  p_reference text default null,
  p_notes text default null
) returns json
language plpgsql security invoker set search_path = public as $$
declare
  v_paid numeric;
begin
  if p_total is null or p_total < 0 then raise exception 'Total must be zero or more'; end if;
  if p_kind = 'rent' then
    select collected_amount into v_paid from rent_collections where id = p_target for update;
  elsif p_kind = 'cost' then
    select collected_amount into v_paid from costs where id = p_target for update;
  elsif p_kind = 'deposit' then
    select deposit_collected into v_paid from leases where id = p_target for update;
  else
    raise exception 'Unknown payment kind %', p_kind;
  end if;
  if v_paid is null then raise exception 'Row not found'; end if;
  if round(p_total - v_paid, 2) = 0 then
    return json_build_object('payment_id', null, 'collected', v_paid, 'unchanged', true);
  end if;
  return public.record_payment(
    p_kind, p_target, round(p_total - v_paid, 2), p_paid_on,
    case when p_total < v_paid then 'adjustment' else p_method end,
    p_reference, p_notes
  );
end $$;

-- ─── Reminder log ───────────────────────────────────────────────────────────

create table if not exists public.reminders (
  id          uuid primary key default gen_random_uuid(),
  lease_id    uuid references public.leases(id) on delete cascade,
  lessee_name text not null,
  kind        text not null default 'overdue' check (kind in ('overdue', 'expiry', 'deposit', 'other')),
  channel     text not null check (channel in ('whatsapp', 'sms', 'email', 'call', 'other')),
  amount      numeric(14,2),
  message     text,
  sent_by     uuid references auth.users(id),
  sent_at     timestamptz not null default now()
);
create index if not exists idx_reminders_lessee on public.reminders (lessee_name, sent_at desc);
alter table public.reminders enable row level security;
drop policy if exists reminders_rw on public.reminders;
create policy reminders_rw on public.reminders using (auth.uid() is not null) with check (auth.uid() is not null);

-- ─── API keys (for the MCP endpoint) ────────────────────────────────────────
-- Only a SHA-256 hash of each key is stored; the key is shown once on creation.

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.user_profiles(id) on delete cascade,
  name         text not null,
  prefix       text not null,
  key_hash     text not null unique,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists idx_api_keys_user on public.api_keys (user_id);
alter table public.api_keys enable row level security;
drop policy if exists api_keys_manage on public.api_keys;
create policy api_keys_manage on public.api_keys
  using (public.is_user_manager()) with check (public.is_user_manager());

-- ─── Audit trail ────────────────────────────────────────────────────────────

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_email text,
  action      text not null,          -- created / updated / deleted
  entity      text not null,          -- table name
  entity_id   text,
  label       text,                   -- human name of the record
  changes     jsonb                   -- {column: [old, new]} for updates; the row for creates/deletes
);
create index if not exists idx_audit_at on public.audit_log (at desc);
create index if not exists idx_audit_entity on public.audit_log (entity, entity_id);
create index if not exists idx_audit_actor on public.audit_log (actor_id, at desc);
alter table public.audit_log enable row level security;
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select using (public.is_user_manager());
-- No insert/update/delete policies: only the trigger below (security definer) writes.

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.current_actor();
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_ignore text[] := array['created_at'];
  k text;
  v_label text;
begin
  -- Rows written by the scheduled jobs (no actor) are routine: skip their inserts.
  if tg_op = 'INSERT' and v_actor is null and tg_table_name in ('rent_collections', 'service_charges') then
    return null;
  end if;

  -- Collection totals are covered by the payments log; don't log them twice.
  if tg_table_name = 'rent_collections' then
    v_ignore := v_ignore || array['collected_amount', 'status', 'collected_at', 'collected_by'];
  elsif tg_table_name = 'costs' then
    v_ignore := v_ignore || array['collected_amount', 'collection_status', 'collected_at', 'collected_by'];
  elsif tg_table_name = 'leases' then
    v_ignore := v_ignore || array['deposit_collected'];
  elsif tg_table_name = 'api_keys' then
    v_ignore := v_ignore || array['key_hash', 'last_used_at'];
  end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if not (k = any (v_ignore)) and (v_old -> k) is distinct from (v_new -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;
  else
    v_changes := v_row - v_ignore;
  end if;

  v_label := coalesce(
    v_row ->> 'lessee_name',
    v_row ->> 'name',
    v_row ->> 'description',
    v_row ->> 'email',
    case when tg_table_name = 'rent_collections' then 'Rent ' || (v_row ->> 'due_month') end,
    case when tg_table_name = 'payments' then initcap(v_row ->> 'kind') || ' payment ' || (v_row ->> 'amount') end,
    case when tg_table_name = 'service_charges' then 'Service charge ' || (v_row ->> 'due_month') end
  );

  insert into audit_log (actor_id, actor_email, action, entity, entity_id, label, changes)
  values (
    v_actor,
    (select email from user_profiles where id = v_actor),
    case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
    tg_table_name,
    v_row ->> 'id',
    v_label,
    v_changes
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'compounds', 'properties', 'leases', 'lease_rent_changes', 'rent_collections',
    'costs', 'service_charges', 'payments', 'reminders', 'user_profiles', 'api_keys'
  ] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()',
      t
    );
  end loop;
end $$;
