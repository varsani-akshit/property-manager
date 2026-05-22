-- Create a public bucket for document uploads (deeds, lease docs).
-- Public so the stored URLs work like Google Drive's "anyone with link" links.
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', true, 26214400)  -- 25 MB cap
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

-- Storage policies: allow any authenticated user to read; only service-role
-- writes (the upload API route uses the service-role key server-side).
do $$ begin
  drop policy if exists "documents read for authed users" on storage.objects;
  create policy "documents read for authed users" on storage.objects
    for select using (bucket_id = 'documents' and auth.role() = 'authenticated');
exception when others then null; end $$;
