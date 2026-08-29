-- Low-egress realtime scope and immutable club-header media.
begin;

-- These keys make high-churn child rows directly filterable by the active
-- club. Existing RPCs remain compatible: triggers derive the keys server-side.
alter table public.replies add column if not exists club_id uuid references public.clubs(id), add column if not exists club_book_id uuid references public.club_books(id);
alter table public.reactions add column if not exists club_id uuid references public.clubs(id), add column if not exists club_book_id uuid references public.club_books(id);
alter table public.meeting_rsvps add column if not exists club_id uuid references public.clubs(id);
alter table public.meeting_option_responses add column if not exists club_id uuid references public.clubs(id), add column if not exists club_book_id uuid references public.club_books(id);
alter table public.ballot_preferences add column if not exists club_id uuid references public.clubs(id);
alter table public.ballot_rankings add column if not exists club_id uuid references public.clubs(id);
alter table public.checkpoint_checkins add column if not exists club_id uuid references public.clubs(id), add column if not exists club_book_id uuid references public.club_books(id);

update public.replies r set club_book_id=p.club_book_id,club_id=cb.club_id from public.posts p join public.club_books cb on cb.id=p.club_book_id where r.post_id=p.id and r.club_id is null;
update public.reactions r set club_book_id=p.club_book_id,club_id=cb.club_id from public.posts p join public.club_books cb on cb.id=p.club_book_id where r.post_id=p.id and r.club_id is null;
update public.meeting_rsvps r set club_id=m.club_id from public.meetings m where r.meeting_id=m.id and r.club_id is null;
update public.meeting_option_responses r set club_id=o.club_id,club_book_id=o.club_book_id from public.meeting_options o where r.option_id=o.id and r.club_id is null;
update public.ballot_preferences p set club_id=b.club_id from public.ballots b where p.ballot_id=b.id and p.club_id is null;
update public.ballot_rankings r set club_id=b.club_id from public.ballots b where r.ballot_id=b.id and r.club_id is null;
update public.checkpoint_checkins c set club_book_id=rc.club_book_id,club_id=cb.club_id from public.reading_checkpoints rc join public.club_books cb on cb.id=rc.club_book_id where c.checkpoint_id=rc.id and c.club_id is null;

create or replace function public.set_realtime_scope_keys()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name in ('replies','reactions') then
    select cb.club_id,p.club_book_id into new.club_id,new.club_book_id from public.posts p join public.club_books cb on cb.id=p.club_book_id where p.id=new.post_id;
  elsif tg_table_name='meeting_rsvps' then
    select club_id into new.club_id from public.meetings where id=new.meeting_id;
  elsif tg_table_name='meeting_option_responses' then
    select club_id,club_book_id into new.club_id,new.club_book_id from public.meeting_options where id=new.option_id;
  elsif tg_table_name in ('ballot_preferences','ballot_rankings') then
    select club_id into new.club_id from public.ballots where id=new.ballot_id;
  elsif tg_table_name='checkpoint_checkins' then
    select cb.club_id,rc.club_book_id into new.club_id,new.club_book_id from public.reading_checkpoints rc join public.club_books cb on cb.id=rc.club_book_id where rc.id=new.checkpoint_id;
  end if;
  if new.club_id is null then raise exception 'Could not determine club scope'; end if;
  return new;
end $$;

drop trigger if exists set_realtime_scope_replies on public.replies;
create trigger set_realtime_scope_replies before insert or update on public.replies for each row execute function public.set_realtime_scope_keys();
drop trigger if exists set_realtime_scope_reactions on public.reactions;
create trigger set_realtime_scope_reactions before insert or update on public.reactions for each row execute function public.set_realtime_scope_keys();
drop trigger if exists set_realtime_scope_meeting_rsvps on public.meeting_rsvps;
create trigger set_realtime_scope_meeting_rsvps before insert or update on public.meeting_rsvps for each row execute function public.set_realtime_scope_keys();
drop trigger if exists set_realtime_scope_meeting_option_responses on public.meeting_option_responses;
create trigger set_realtime_scope_meeting_option_responses before insert or update on public.meeting_option_responses for each row execute function public.set_realtime_scope_keys();
drop trigger if exists set_realtime_scope_ballot_preferences on public.ballot_preferences;
create trigger set_realtime_scope_ballot_preferences before insert or update on public.ballot_preferences for each row execute function public.set_realtime_scope_keys();
drop trigger if exists set_realtime_scope_ballot_rankings on public.ballot_rankings;
create trigger set_realtime_scope_ballot_rankings before insert or update on public.ballot_rankings for each row execute function public.set_realtime_scope_keys();
drop trigger if exists set_realtime_scope_checkpoint_checkins on public.checkpoint_checkins;
create trigger set_realtime_scope_checkpoint_checkins before insert or update on public.checkpoint_checkins for each row execute function public.set_realtime_scope_keys();

create index if not exists replies_club_id_idx on public.replies(club_id);
create index if not exists reactions_club_id_idx on public.reactions(club_id);
create index if not exists meeting_rsvps_club_id_idx on public.meeting_rsvps(club_id);
create index if not exists meeting_option_responses_club_id_idx on public.meeting_option_responses(club_id);
create index if not exists ballot_preferences_club_id_idx on public.ballot_preferences(club_id);
create index if not exists ballot_rankings_club_id_idx on public.ballot_rankings(club_id);
create index if not exists checkpoint_checkins_club_id_idx on public.checkpoint_checkins(club_id);

-- Versioned WebP objects can be cached forever. Keep legacy header.jpg readable
-- until a club replaces it.
drop policy if exists "Club members can read club header media" on storage.objects;
drop policy if exists "Club members can insert club header media" on storage.objects;
drop policy if exists "Club members can update club header media" on storage.objects;
drop policy if exists "Club members can delete club header media" on storage.objects;
create policy "Club members can read club header media" on storage.objects for select to authenticated using (bucket_id='club-media' and (storage.filename(name)='header.jpg' or storage.filename(name) ~ '^header-[0-9a-f-]{36}\\.webp$') and public.is_club_member(((storage.foldername(name))[1])::uuid));
create policy "Club members can insert club header media" on storage.objects for insert to authenticated with check (bucket_id='club-media' and storage.filename(name) ~ '^header-[0-9a-f-]{36}\\.webp$' and public.is_club_member(((storage.foldername(name))[1])::uuid));
create policy "Club members can delete club header media" on storage.objects for delete to authenticated using (bucket_id='club-media' and (storage.filename(name)='header.jpg' or storage.filename(name) ~ '^header-[0-9a-f-]{36}\\.webp$') and public.is_club_member(((storage.foldername(name))[1])::uuid));

create or replace function public.update_club_header(target_club_id uuid,target_cover_path text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.is_club_member(target_club_id) then raise exception 'You must be a member of this club'; end if;
  if target_cover_path is not null and target_cover_path !~ ('^' || target_club_id::text || '/(header\\.jpg|header-[0-9a-f-]{36}\\.webp)$') then raise exception 'Invalid club header path'; end if;
  update public.clubs set cover_image_url=target_cover_path,updated_at=now() where id=target_club_id;
end $$;
revoke all on function public.update_club_header(uuid,text) from public,anon;
grant execute on function public.update_club_header(uuid,text) to authenticated;
commit;
