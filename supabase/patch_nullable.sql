-- Allow lessee_contact and lessee_doc_url to be nullable (Excel import has no contacts yet).
alter table public.leases alter column lessee_contact drop not null;
