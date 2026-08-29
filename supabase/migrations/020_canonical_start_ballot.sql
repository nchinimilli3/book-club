-- Canonical vote-start contract. This repairs databases where the concierge
-- columns were applied but the RPC itself was never created.
begin;

drop function if exists public.start_ballot_from_ideas(uuid);
drop function if exists public.start_ballot_from_ideas(uuid, timestamptz);

create function public.start_ballot_from_ideas(
  target_club_id uuid,
  requested_closes_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_ballot_id uuid;
  idea_count integer;
  deadline timestamptz := coalesce(requested_closes_at, now() + interval '5 days');
begin
  if uid is null then
    raise exception 'You must be signed in';
  end if;

  if not public.is_club_member(target_club_id) then
    raise exception 'Only joined club members can start the vote';
  end if;

  if deadline <= now() + interval '15 minutes' then
    raise exception 'Voting deadline must be in the future';
  end if;
  if deadline > now() + interval '30 days' then
    raise exception 'Voting deadline is too far away';
  end if;

  select id into new_ballot_id
  from public.ballots
  where club_id = target_club_id
    and status in ('open', 'needs_decision')
  order by created_at desc
  limit 1;
  if new_ballot_id is not null then
    return new_ballot_id;
  end if;

  select count(*) into idea_count
  from public.club_books
  where club_id = target_club_id
    and status in ('idea', 'nominated');
  if idea_count < 2 then
    raise exception 'Add at least two books before starting a vote';
  end if;

  insert into public.ballots(club_id, status, opens_at, closes_at, created_by, round, voting_method)
  values (target_club_id, 'open', now(), deadline, uid, 1, 'ranked_choice')
  returning id into new_ballot_id;

  insert into public.nominations(club_id, book_id, nominated_by, ballot_id)
  select target_club_id, cb.book_id, coalesce(cb.created_by, uid), new_ballot_id
  from public.club_books cb
  where cb.club_id = target_club_id
    and cb.status in ('idea', 'nominated');

  update public.club_books
  set status = 'ballot'
  where club_id = target_club_id
    and status in ('idea', 'nominated');

  update public.clubs
  set status = 'choosing'
  where id = target_club_id;

  return new_ballot_id;
end;
$$;

revoke all on function public.start_ballot_from_ideas(uuid, timestamptz) from public, anon;
grant execute on function public.start_ballot_from_ideas(uuid, timestamptz) to authenticated;

commit;
