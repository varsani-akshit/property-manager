-- Revert: drop the Drive OAuth table (we went back to paste-link only).
drop table if exists public.google_drive_auth;
