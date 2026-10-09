-- 025: Payments entered during the migration (before the payment log existed)
-- were stamped with the day they were typed in, not the day they were paid —
-- e.g. 411 rent rows "collected" on 11/08/2026 for months back to 2022. That
-- inflated recent collections (dashboard collection rate > 100%).
--
-- For every pre-log ('opening') rent and charge payment dated AFTER its due
-- date, set the paid date to the due date — on the payment log entry and on
-- the rent row / charge itself. Prepayments (dated on or before the due date)
-- and deposits are left alone. One summary line goes in the audit trail.
--
-- Run once:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/025_backdate_migration_payments.sql

alter table public.payments disable trigger audit_payments;
alter table public.costs disable trigger audit_costs;

create temp table _backdate on commit drop as
select p.id as payment_id, p.kind, p.rent_collection_id, p.cost_id,
       p.paid_on as old_paid_on, coalesce(r.due_date, c.due_date) as due_date
from public.payments p
left join public.rent_collections r on r.id = p.rent_collection_id
left join public.costs c on c.id = p.cost_id
where p.method = 'opening'
  and p.kind in ('rent', 'cost')
  and coalesce(r.due_date, c.due_date) is not null
  and p.paid_on > coalesce(r.due_date, c.due_date);

update public.payments p set paid_on = b.due_date
from _backdate b where p.id = b.payment_id;

update public.rent_collections r set collected_at = b.due_date::timestamptz
from _backdate b where b.kind = 'rent' and r.id = b.rent_collection_id;

update public.costs c set collected_at = b.due_date::timestamptz
from _backdate b where b.kind = 'cost' and c.id = b.cost_id;

insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, label, changes)
select null, null, 'updated', 'payments', null,
       'Migration payments back-dated to their due dates',
       jsonb_build_object(
         'reason', 'Pre-log payments carried the date they were entered, not paid',
         'rent_entries', count(*) filter (where kind = 'rent'),
         'charge_entries', count(*) filter (where kind = 'cost'),
         'entered_between', jsonb_build_array(min(old_paid_on), max(old_paid_on))
       )
from _backdate;

alter table public.payments enable trigger audit_payments;
alter table public.costs enable trigger audit_costs;
