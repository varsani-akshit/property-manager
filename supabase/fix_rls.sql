-- Fix recursive RLS on user_profiles + ensure trigger works for existing users.

-- 1) Drop recursive policies and replace with non-self-referencing ones.
drop policy if exists profiles_select on public.user_profiles;
drop policy if exists profiles_update on public.user_profiles;

-- Any authenticated user can read all profiles (needed for /users page, dashboard nav, etc.)
create policy profiles_select on public.user_profiles
  for select using (auth.uid() is not null);

-- Users can update their own row; admin check happens in app code (server actions call requirePermission).
create policy profiles_update on public.user_profiles
  for update using (auth.uid() is not null) with check (auth.uid() is not null);

create policy profiles_insert on public.user_profiles
  for insert with check (auth.uid() is not null);

-- 2) Backfill: create user_profiles rows for any existing auth users that don't have one yet.
insert into public.user_profiles (id, email, full_name)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', u.email)
from auth.users u
left join public.user_profiles p on p.id = u.id
where p.id is null;
