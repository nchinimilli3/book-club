-- BOOK CLUB migration 007
-- Repairs the club idea -> ballot contract and records who suggested each idea.
-- Safe to run more than once.

begin;

grant usage on schema public to authenticated;

alter table public.club_books
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- Existing idea rows predate creator tracking. Leave them unknown rather than inventing
-- attribution. New rows are written with auth.uid() by the frontend.

create or replace function public.start_ballot_from_ideas(target_club_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_ballot_id uuid;
  idea_count integer;
begin
  if uid is null then
    raise exception 'You must be signed in';
  end if;

  if not exists (
    select 1
    from public.club_members cm
    where cm.club_id = target_club_id
      and cm.user_id = uid
      and cm.role in ('owner','admin')
  ) and not exists (
    select 1 from public.clubs c
    where c.id = target_club_id and c.owner_id = uid
  ) then
    raise exception 'Only a club owner or admin can start the vote';
  end if;

  if exists (
    select 1 from public.ballots
    where club_id = target_club_id and status = 'open'
  ) then
    select id into new_ballot_id
    from public.ballots
    where club_id = target_club_id and status = 'open'
    order by created_at desc
    limit 1;
    return new_ballot_id;
  end if;

  select count(*) into idea_count
  from public.club_books
  where club_id = target_club_id
    and status in ('idea','nominated');

  if idea_count < 2 then
    raise exception 'Add at least two books before starting a vote';
  end if;

  insert into public.ballots(club_id,status,created_by)
  values(target_club_id,'open',uid)
  returning id into new_ballot_id;

  insert into public.nominations(club_id,book_id,nominated_by,ballot_id)
  select target_club_id, cb.book_id, coalesce(cb.created_by,uid), new_ballot_id
  from public.club_books cb
  where cb.club_id = target_club_id
    and cb.status in ('idea','nominated');

  update public.club_books
  set status = 'ballot'
  where club_id = target_club_id
    and status in ('idea','nominated');

  update public.clubs
  set status = 'choosing'
  where id = target_club_id;

  return new_ballot_id;
end;
$$;

revoke all on function public.start_ballot_from_ideas(uuid) from public;
grant execute on function public.start_ballot_from_ideas(uuid) to authenticated;

-- Keep the rest of the ballot lifecycle in the same repair. This makes 007 safe even
-- if an earlier runtime-wiring migration never reached the live database.
create or replace function public.cast_ballot_vote(target_nomination_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_ballot_id uuid;
  target_club_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select n.ballot_id, n.club_id into target_ballot_id, target_club_id
  from public.nominations n where n.id = target_nomination_id;

  if target_ballot_id is null then raise exception 'Nomination not found'; end if;
  if not public.is_club_member(target_club_id) then raise exception 'Not a member'; end if;
  if not exists(select 1 from public.ballots where id=target_ballot_id and status='open') then
    raise exception 'Voting is closed';
  end if;

  delete from public.votes
  where user_id = auth.uid()
    and nomination_id in (select id from public.nominations where ballot_id=target_ballot_id);

  insert into public.votes(nomination_id,user_id)
  values(target_nomination_id,auth.uid())
  on conflict (nomination_id,user_id) do nothing;
end;
$$;

revoke all on function public.cast_ballot_vote(uuid) from public;
grant execute on function public.cast_ballot_vote(uuid) to authenticated;

-- Older club_books schemas used a narrower status check. Normalize it before a
-- winner is promoted to acquiring so vote completion cannot fail at that boundary.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
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

create or replace function public.finalize_ballot(target_ballot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_club_id uuid;
  winner_book_id uuid;
  top_votes bigint;
  tied_count integer;
  winner_club_book_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select club_id into target_club_id
  from public.ballots where id=target_ballot_id and status='open';
  if target_club_id is null then raise exception 'Open ballot not found'; end if;

  if not exists (
    select 1 from public.club_members cm
    where cm.club_id=target_club_id and cm.user_id=auth.uid() and cm.role in ('owner','admin')
  ) and not exists (
    select 1 from public.clubs c where c.id=target_club_id and c.owner_id=auth.uid()
  ) then
    raise exception 'Only a club owner or admin can close the vote';
  end if;

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

  select n.book_id into winner_book_id
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

  update public.ballots
  set status='closed', closes_at=coalesce(closes_at,now())
  where id=target_ballot_id;

  update public.clubs set status='acquiring' where id=target_club_id;
  return winner_club_book_id;
end;
$$;

revoke all on function public.finalize_ballot(uuid) from public;
grant execute on function public.finalize_ballot(uuid) to authenticated;

grant select, insert, update on public.club_books to authenticated;
grant select, insert, update on public.ballots to authenticated;
grant select, insert, update on public.nominations to authenticated;

-- Favorites are an independent personal-library property. Older live databases may
-- have reached this build before that column was added, so make the contract explicit.
alter table public.personal_books
  add column if not exists is_favorite boolean not null default false;

grant select, insert, update on public.personal_books to authenticated;

-- Preserve the old five-star-as-favorite behavior only as a one-time compatibility
-- backfill. From this migration forward a rating and Favorite are separate choices.
update public.personal_books
set is_favorite = true
where rating = 5 and coalesce(is_favorite, false) = false;

commit;

notify pgrst, 'reload schema';
