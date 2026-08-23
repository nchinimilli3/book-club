-- BOOK CLUB runtime wiring alignment — 2026-08-23
-- Safe to run AFTER the previously-applied core + backend-phase2 + permissions + profile-saving SQL.
-- This migration does not change the visual/profile scrapbook system.

begin;

-- Existing accounts created before user_preferences was introduced need a row too.
insert into public.user_preferences(user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- AuthGate sends display_name. Keep full_name compatibility for older signups.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, display_name, username)
  values(
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)),
    split_part(new.email,'@',1) || '_' || substr(new.id::text,1,6)
  )
  on conflict (id) do nothing;

  insert into public.user_preferences(user_id)
  values(new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Favorites are independent of ratings. Backfill old 5-star books so nobody loses
-- what previously appeared in the Favorites shelf.
alter table public.personal_books
  add column if not exists is_favorite boolean not null default false;
update public.personal_books set is_favorite=true where rating=5 and is_favorite=false;

grant select, insert, update, delete on public.personal_books to authenticated;


-- The reading-cycle state machine uses 'acquiring' and planning/rating states. Some
-- early local schema copies used a narrower club_books check constraint, which would
-- make a real ballot winner fail at the database boundary. Normalize the check.
do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid='public.club_books'::regclass
      and contype='c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.club_books drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.club_books
  add constraint club_books_status_check
  check (status in ('idea','nominated','ballot','up_next','acquiring','reading','planning','planning_meeting','meeting','rating','finished','dnf','archived'));

-- One club ballot is built from the existing idea-pile club_book rows.
-- The book does NOT become the current read until a completed ballot has a winner.
create or replace function public.start_ballot_from_ideas(target_club_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  new_ballot_id uuid;
  idea_count integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_club_owner(target_club_id) then raise exception 'Only the club owner can start the vote'; end if;

  if exists(select 1 from public.ballots where club_id=target_club_id and status='open') then
    raise exception 'This club already has an open vote';
  end if;

  select count(*) into idea_count
  from public.club_books
  where club_id=target_club_id and status in ('idea','nominated');
  if idea_count < 2 then raise exception 'Add at least two books before starting a vote'; end if;

  insert into public.ballots(club_id,status,created_by)
  values(target_club_id,'open',auth.uid())
  returning id into new_ballot_id;

  insert into public.nominations(club_id,book_id,nominated_by,ballot_id)
  select target_club_id, cb.book_id, coalesce(cb.created_by,auth.uid()), new_ballot_id
  from public.club_books cb
  where cb.club_id=target_club_id and cb.status in ('idea','nominated');

  update public.club_books
  set status='ballot'
  where club_id=target_club_id and status in ('idea','nominated');

  update public.clubs set status='choosing' where id=target_club_id;
  return new_ballot_id;
end;
$$;

revoke all on function public.start_ballot_from_ideas(uuid) from public;
grant execute on function public.start_ballot_from_ideas(uuid) to authenticated;

-- A ballot is single-choice. Voting again changes the user's vote instead of creating
-- multiple votes across different nominations in the same ballot.
create or replace function public.cast_ballot_vote(target_nomination_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  target_ballot_id uuid;
  target_club_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select n.ballot_id,n.club_id into target_ballot_id,target_club_id
  from public.nominations n where n.id=target_nomination_id;
  if target_ballot_id is null then raise exception 'Nomination not found'; end if;
  if not public.is_club_member(target_club_id) then raise exception 'Not a member'; end if;
  if not exists(select 1 from public.ballots where id=target_ballot_id and status='open') then raise exception 'Voting is closed'; end if;

  delete from public.votes
  where user_id=auth.uid()
    and nomination_id in (select id from public.nominations where ballot_id=target_ballot_id);

  insert into public.votes(nomination_id,user_id)
  values(target_nomination_id,auth.uid())
  on conflict (nomination_id,user_id) do nothing;
end;
$$;

revoke all on function public.cast_ballot_vote(uuid) from public;
grant execute on function public.cast_ballot_vote(uuid) to authenticated;

-- Close a vote and promote the UNIQUE top choice. A tie remains unresolved rather than
-- silently selecting an arbitrary book.
create or replace function public.finalize_ballot(target_ballot_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  target_club_id uuid;
  winner_nomination_id uuid;
  winner_book_id uuid;
  top_votes bigint;
  tied_count integer;
  winner_club_book_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select club_id into target_club_id from public.ballots where id=target_ballot_id and status='open';
  if target_club_id is null then raise exception 'Open ballot not found'; end if;
  if not public.is_club_owner(target_club_id) then raise exception 'Only the club owner can close the vote'; end if;

  select max(vote_count) into top_votes
  from (
    select n.id,count(v.nomination_id) vote_count
    from public.nominations n left join public.votes v on v.nomination_id=n.id
    where n.ballot_id=target_ballot_id
    group by n.id
  ) counts;
  if coalesce(top_votes,0)=0 then raise exception 'No votes have been cast yet'; end if;

  select count(*) into tied_count
  from (
    select n.id,count(v.nomination_id) vote_count
    from public.nominations n left join public.votes v on v.nomination_id=n.id
    where n.ballot_id=target_ballot_id
    group by n.id
  ) counts where vote_count=top_votes;
  if tied_count<>1 then raise exception 'The vote is tied. Keep it open or run a tie-breaker.'; end if;

  select n.id,n.book_id into winner_nomination_id,winner_book_id
  from public.nominations n left join public.votes v on v.nomination_id=n.id
  where n.ballot_id=target_ballot_id
  group by n.id,n.book_id
  order by count(v.nomination_id) desc
  limit 1;

  select id into winner_club_book_id
  from public.club_books
  where club_id=target_club_id and book_id=winner_book_id
  order by created_at desc limit 1;

  if winner_club_book_id is null then
    insert into public.club_books(club_id,book_id,status,created_by)
    values(target_club_id,winner_book_id,'acquiring',auth.uid())
    returning id into winner_club_book_id;
  else
    update public.club_books set status='acquiring' where id=winner_club_book_id;
  end if;

  update public.club_books
  set status='idea'
  where club_id=target_club_id and status='ballot' and id<>winner_club_book_id;

  update public.ballots set status='closed',closes_at=coalesce(closes_at,now()) where id=target_ballot_id;
  update public.clubs set status='acquiring' where id=target_club_id;
  return winner_club_book_id;
end;
$$;

revoke all on function public.finalize_ballot(uuid) from public;
grant execute on function public.finalize_ballot(uuid) to authenticated;

commit;
