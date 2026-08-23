-- BOOK CLUB: PostgREST/API privileges for signed-in users.
-- RLS remains the security boundary; these GRANTs only let the authenticated
-- role reach the tables so the row-level policies can be evaluated.

grant usage on schema public to authenticated;

grant select, insert, update, delete
on all tables in schema public
to authenticated;

grant usage, select
on all sequences in schema public
to authenticated;

-- Keep future migrations from silently creating tables that PostgREST cannot
-- access. RLS policies still decide which rows/actions are allowed.
alter default privileges in schema public
grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
grant usage, select on sequences to authenticated;

-- The app is private/authenticated; do not broaden table access for anon.
-- Functions used by the client are granted individually in the core/phase-2
-- migrations.
