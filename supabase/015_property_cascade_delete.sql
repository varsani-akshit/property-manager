-- Switch property foreign keys from RESTRICT to CASCADE so a property delete
-- automatically cleans up its leases (and via cascade their rent_collections)
-- and its service_charges. Costs are NOT cascaded — they're company expenses
-- which can survive a property removal (the allocation rows do cascade).
alter table public.leases drop constraint if exists leases_property_id_fkey;
alter table public.leases
  add constraint leases_property_id_fkey
  foreign key (property_id) references public.properties(id) on delete cascade;

alter table public.service_charges drop constraint if exists service_charges_property_id_fkey;
alter table public.service_charges
  add constraint service_charges_property_id_fkey
  foreign key (property_id) references public.properties(id) on delete cascade;
