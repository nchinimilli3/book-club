-- BOOK CLUB migration 017 — next-read concierge and private ranked voting.
-- Apply after 009 and 012. Existing broad-support and legacy ballots remain intact.

alter table public.books add column if not exists subjects text[] not null default '{}';
alter table public.ballots
  add column if not exists voting_method text not null default 'broad_support',
  add column if not exists tie_break jsonb;

alter table public.ballots drop constraint if exists ballots_voting_method_check;
alter table public.ballots add constraint ballots_voting_method_check
  check (voting_method in ('broad_support','ranked_choice'));

create table if not exists public.ballot_rankings(
  ballot_id uuid not null references public.ballots(id) on delete cascade,
  nomination_id uuid not null references public.nominations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rank smallint not null check(rank between 1 and 3),
  updated_at timestamptz not null default now(),
  primary key(ballot_id,user_id,nomination_id),
  unique(ballot_id,user_id,rank)
);
create index if not exists ballot_rankings_ballot_idx on public.ballot_rankings(ballot_id,user_id,rank);
alter table public.ballot_rankings enable row level security;
revoke all on public.ballot_rankings from anon,authenticated;

create or replace function public.add_club_idea(target_club_id uuid,target_book_id uuid)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); existing_row public.club_books; count_for_member integer; new_id uuid;
begin
  if uid is null then raise exception 'You must be signed in'; end if;
  if not public.is_club_member(target_club_id) then raise exception 'Not a club member'; end if;
  if exists(select 1 from public.ballots where club_id=target_club_id and status in ('open','needs_decision')) then
    raise exception 'Voting is already open. Wait for the club to choose before adding another candidate';
  end if;
  select * into existing_row from public.club_books
  where club_id=target_club_id and book_id=target_book_id
    and status in ('idea','nominated','ballot','up_next','acquiring','reading')
  order by created_at desc limit 1;
  if existing_row.id is not null then
    return jsonb_build_object('clubBookId',existing_row.id,'alreadySaved',true);
  end if;
  select count(*) into count_for_member from public.club_books
  where club_id=target_club_id and created_by=uid and status in ('idea','nominated');
  if count_for_member>=3 then raise exception 'You can keep up to three books on the table. Remove one to suggest another'; end if;
  insert into public.club_books(club_id,book_id,status,created_by)
  values(target_club_id,target_book_id,'idea',uid) returning id into new_id;
  return jsonb_build_object('clubBookId',new_id,'alreadySaved',false);
end $$;
revoke all on function public.add_club_idea(uuid,uuid) from public,anon;
grant execute on function public.add_club_idea(uuid,uuid) to authenticated;

-- New ballots use ranked choice. The old broad-support resolver stays available
-- for ballots created before this migration.
create or replace function public.start_ballot_from_ideas(target_club_id uuid,requested_closes_at timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); new_ballot_id uuid; idea_count integer; deadline timestamptz:=coalesce(requested_closes_at,now()+interval '5 days');
begin
  if uid is null then raise exception 'You must be signed in'; end if;
  if not exists(select 1 from public.club_members where club_id=target_club_id and user_id=uid and role in ('owner','admin'))
     and not exists(select 1 from public.clubs where id=target_club_id and owner_id=uid) then raise exception 'Only a club owner or admin can start the vote'; end if;
  if deadline<=now()+interval '15 minutes' then raise exception 'Voting deadline must be in the future'; end if;
  if deadline>now()+interval '30 days' then raise exception 'Voting deadline is too far away'; end if;
  select id into new_ballot_id from public.ballots where club_id=target_club_id and status in ('open','needs_decision') order by created_at desc limit 1;
  if new_ballot_id is not null then return new_ballot_id; end if;
  select count(*) into idea_count from public.club_books where club_id=target_club_id and status in ('idea','nominated');
  if idea_count<2 then raise exception 'Add at least two books before starting a vote'; end if;
  insert into public.ballots(club_id,status,opens_at,closes_at,created_by,round,voting_method)
  values(target_club_id,'open',now(),deadline,uid,1,'ranked_choice') returning id into new_ballot_id;
  insert into public.nominations(club_id,book_id,nominated_by,ballot_id)
    select target_club_id,cb.book_id,coalesce(cb.created_by,uid),new_ballot_id
    from public.club_books cb where cb.club_id=target_club_id and cb.status in ('idea','nominated');
  update public.club_books set status='ballot' where club_id=target_club_id and status in ('idea','nominated');
  update public.clubs set status='choosing' where id=target_club_id;
  return new_ballot_id;
end $$;
-- CREATE OR REPLACE preserves grants only when the prior overload already existed.
-- Grant the canonical concierge RPC explicitly so a database with only the base
-- one-argument function cannot fail with a misleading permission error.
revoke all on function public.start_ballot_from_ideas(uuid,timestamptz) from public,anon;
grant execute on function public.start_ballot_from_ideas(uuid,timestamptz) to authenticated;

create or replace function public.get_my_ballot_ranking(target_ballot_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); cid uuid; ids uuid[]; voters integer;
begin
  if uid is null then raise exception 'You must be signed in'; end if;
  select club_id into cid from public.ballots where id=target_ballot_id;
  if cid is null or not public.is_club_member(cid) then raise exception 'Not a club member'; end if;
  select array_agg(nomination_id order by rank) into ids from public.ballot_rankings where ballot_id=target_ballot_id and user_id=uid;
  select count(distinct user_id) into voters from public.ballot_rankings where ballot_id=target_ballot_id;
  return jsonb_build_object('nominationIds',coalesce(to_jsonb(ids),'[]'::jsonb),'voterCount',voters);
end $$;
revoke all on function public.get_my_ballot_ranking(uuid) from public,anon;
grant execute on function public.get_my_ballot_ranking(uuid) to authenticated;

create or replace function public.set_ballot_ranking(target_ballot_id uuid,target_nomination_ids uuid[])
returns void language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); cid uuid; supplied integer:=coalesce(array_length(target_nomination_ids,1),0);
begin
  if uid is null then raise exception 'You must be signed in'; end if;
  if supplied>3 then raise exception 'Rank up to three books'; end if;
  if (select count(distinct x) from unnest(target_nomination_ids) x)<>supplied then raise exception 'Each ranked book must be unique'; end if;
  select club_id into cid from public.ballots where id=target_ballot_id and status='open' and voting_method='ranked_choice';
  if cid is null then raise exception 'Open ranked ballot not found'; end if;
  if not public.is_club_member(cid) then raise exception 'Not a club member'; end if;
  if (select count(*) from public.nominations where ballot_id=target_ballot_id and id=any(target_nomination_ids))<>supplied then raise exception 'A ranked book is not on this ballot'; end if;
  delete from public.ballot_rankings where ballot_id=target_ballot_id and user_id=uid;
  insert into public.ballot_rankings(ballot_id,nomination_id,user_id,rank)
    select target_ballot_id,x,uid,ord::smallint from unnest(target_nomination_ids) with ordinality as rows(x,ord);
end $$;
revoke all on function public.set_ballot_ranking(uuid,uuid[]) from public,anon;
grant execute on function public.set_ballot_ranking(uuid,uuid[]) to authenticated;

create or replace function public.resolve_ranked_ballot(target_ballot_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ballot_row public.ballots; active_ids uuid[]; top_ids uuid[]; lowest_ids uuid[]; winner_nomination uuid; winner_book uuid; winner_club_book uuid; continuing integer; top_votes integer; lowest_votes integer; selected uuid;
begin
  select * into ballot_row from public.ballots where id=target_ballot_id and status='open' and voting_method='ranked_choice' for update;
  if ballot_row.id is null then return jsonb_build_object('kind','ignored'); end if;
  select array_agg(id order by id) into active_ids from public.nominations where ballot_id=target_ballot_id;
  if coalesce(array_length(active_ids,1),0)<2 then raise exception 'A ranked ballot needs at least two candidates'; end if;
  loop
    with first_choices as (
      select distinct on (r.user_id) r.user_id,r.nomination_id
      from public.ballot_rankings r where r.ballot_id=target_ballot_id and r.nomination_id=any(active_ids)
      order by r.user_id,r.rank
    ), counts as (
      select n.id,count(fc.user_id)::integer as votes from public.nominations n left join first_choices fc on fc.nomination_id=n.id
      where n.id=any(active_ids) group by n.id
    ) select count(*) filter(where votes is not null),coalesce(max(votes),0) into continuing,top_votes from counts where votes>0;
    -- count voters rather than candidates for a strict majority.
    select count(*) into continuing from (
      select distinct on (r.user_id) r.user_id from public.ballot_rankings r
      where r.ballot_id=target_ballot_id and r.nomination_id=any(active_ids) order by r.user_id,r.rank
    ) voters;
    with first_choices as (
      select distinct on (r.user_id) r.user_id,r.nomination_id from public.ballot_rankings r
      where r.ballot_id=target_ballot_id and r.nomination_id=any(active_ids) order by r.user_id,r.rank
    ), counts as (
      select n.id,count(fc.user_id)::integer as votes from public.nominations n left join first_choices fc on fc.nomination_id=n.id
      where n.id=any(active_ids) group by n.id
    ) select array_agg(id order by id) into top_ids from counts where votes=top_votes;
    if array_length(top_ids,1)=1 and top_votes*2>continuing then winner_nomination:=top_ids[1]; exit; end if;
    if array_length(active_ids,1)=2 and array_length(top_ids,1)=2 then
      selected:=top_ids[1+floor(random()*array_length(top_ids,1))::integer];
      select book_id into winner_book from public.nominations where id=selected;
      update public.ballots set tie_break=jsonb_build_object('kind','random_draw','finalists',to_jsonb(top_ids),'winnerNominationId',selected,'resolvedAt',now()) where id=target_ballot_id;
      winner_club_book:=public.apply_ballot_winner(target_ballot_id,winner_book);
      return jsonb_build_object('kind','winner','clubBookId',winner_club_book,'bookId',winner_book,'tieBreak','random_draw');
    end if;
    with first_choices as (
      select distinct on (r.user_id) r.user_id,r.nomination_id from public.ballot_rankings r
      where r.ballot_id=target_ballot_id and r.nomination_id=any(active_ids) order by r.user_id,r.rank
    ), counts as (
      select n.id,count(fc.user_id)::integer as votes from public.nominations n left join first_choices fc on fc.nomination_id=n.id
      where n.id=any(active_ids) group by n.id
    ) select min(votes) into lowest_votes from counts;
    with first_choices as (
      select distinct on (r.user_id) r.user_id,r.nomination_id from public.ballot_rankings r
      where r.ballot_id=target_ballot_id and r.nomination_id=any(active_ids) order by r.user_id,r.rank
    ), counts as (
      select n.id,count(fc.user_id)::integer as votes from public.nominations n left join first_choices fc on fc.nomination_id=n.id
      where n.id=any(active_ids) group by n.id
    ) select array_agg(id order by id) into lowest_ids from counts where votes=lowest_votes;
    if array_length(lowest_ids,1)=array_length(active_ids,1) then
      selected:=lowest_ids[1+floor(random()*array_length(lowest_ids,1))::integer];
      select book_id into winner_book from public.nominations where id=selected;
      update public.ballots set tie_break=jsonb_build_object('kind','random_draw','finalists',to_jsonb(lowest_ids),'winnerNominationId',selected,'resolvedAt',now()) where id=target_ballot_id;
      winner_club_book:=public.apply_ballot_winner(target_ballot_id,winner_book);
      return jsonb_build_object('kind','winner','clubBookId',winner_club_book,'bookId',winner_book,'tieBreak','random_draw');
    end if;
    active_ids:=array_remove(active_ids,lowest_ids[1]);
  end loop;
  select book_id into winner_book from public.nominations where id=winner_nomination;
  winner_club_book:=public.apply_ballot_winner(target_ballot_id,winner_book);
  return jsonb_build_object('kind','winner','clubBookId',winner_club_book,'bookId',winner_book);
end $$;
revoke all on function public.resolve_ranked_ballot(uuid) from public,anon,authenticated;

create or replace function public.finalize_ballot(target_ballot_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid; method text; result jsonb;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select club_id,voting_method into cid,method from public.ballots where id=target_ballot_id and status='open';
  if cid is null then raise exception 'Open ballot not found'; end if;
  if not exists(select 1 from public.club_members where club_id=cid and user_id=auth.uid() and role in ('owner','admin'))
     and not exists(select 1 from public.clubs where id=cid and owner_id=auth.uid()) then raise exception 'Only a club owner or admin can close the vote'; end if;
  if method='ranked_choice' then
    result:=public.resolve_ranked_ballot(target_ballot_id);
    if result->>'kind'='winner' then return (result->>'clubBookId')::uuid; end if;
    return null;
  end if;
  result:=public.resolve_ballot(target_ballot_id);
  if result->>'kind'='winner' then return (result->>'clubBookId')::uuid; end if;
  return null;
end $$;
revoke all on function public.finalize_ballot(uuid) from public,anon;
grant execute on function public.finalize_ballot(uuid) to authenticated;

create or replace function public.process_ballot_automation()
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; processed integer:=0; reminders integer:=0;
begin
  insert into public.notifications(user_id,club_id,type,title,body,deep_link)
  select cm.user_id,b.club_id,'ballot_closing','Voting closes tomorrow','Your club vote closes in about 24 hours.', '/clubs/'||b.club_id::text||'?ballot='||b.id::text
  from public.ballots b join public.club_members cm on cm.club_id=b.club_id
  where b.status='open' and b.closes_at>now()+interval '23 hours 45 minutes' and b.closes_at<=now()+interval '24 hours 15 minutes'
    and not exists(select 1 from public.notifications n where n.user_id=cm.user_id and n.type='ballot_closing' and n.deep_link='/clubs/'||b.club_id::text||'?ballot='||b.id::text);
  get diagnostics reminders=row_count;
  for r in select id,voting_method from public.ballots where status='open' and closes_at is not null and closes_at<=now() order by closes_at loop
    if r.voting_method='ranked_choice' then perform public.resolve_ranked_ballot(r.id); else perform public.resolve_ballot(r.id); end if;
    processed:=processed+1;
  end loop;
  return jsonb_build_object('processed',processed,'reminders',reminders);
end $$;
revoke all on function public.process_ballot_automation() from public,anon,authenticated;
grant execute on function public.process_ballot_automation() to service_role;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='ballot_rankings') then alter publication supabase_realtime add table public.ballot_rankings; end if;
end $$;
