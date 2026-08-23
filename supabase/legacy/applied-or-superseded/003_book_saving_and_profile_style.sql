-- BOOK CLUB: make catalog saving + profile customization actually writable.
-- RLS still protects private club rows; this only adds the missing insert paths.

alter table public.profiles
  add column if not exists profile_style jsonb not null default '{"palette":"rose","layout":"scrapbook","note":""}'::jsonb;

-- The global book catalog is shared metadata. Signed-in users may add missing titles;
-- club membership / personal-library RLS still controls where those books can be used.
drop policy if exists "books authenticated insert" on public.books;
create policy "books authenticated insert"
on public.books for insert to authenticated
with check (auth.uid() is not null);

-- Members need to be able to place a title in their club's idea pile.
-- Existing admin policies continue to govern edits/deletes to the club reading cycle.
drop policy if exists "club books members insert ideas" on public.club_books;
create policy "club books members insert ideas"
on public.club_books for insert to authenticated
with check (
  public.is_club_member(club_id)
  and status in ('idea','nominated')
);

grant select, insert on public.books to authenticated;
grant select, insert on public.club_books to authenticated;
grant select, update on public.profiles to authenticated;

-- Backfill a style object for profiles created before this migration.
update public.profiles
set profile_style = '{"palette":"rose","layout":"scrapbook","note":""}'::jsonb
where profile_style is null;
