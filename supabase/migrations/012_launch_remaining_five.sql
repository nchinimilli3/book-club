-- BOOK CLUB migration 012 — final five production fixes
-- Idempotent. Extends the existing ballot, reading-plan, calendar, preference, and realtime systems.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Persisted checkpoint meeting check-ins
-- ---------------------------------------------------------------------------
create table if not exists public.checkpoint_checkins (
  checkpoint_id uuid not null references public.reading_checkpoints(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('reached','catching_up','not_yet')),
  updated_at timestamptz not null default now(),
  primary key (checkpoint_id,user_id)
);
create index if not exists checkpoint_checkins_user_idx on public.checkpoint_checkins(user_id);
alter table public.checkpoint_checkins enable row level security;

drop policy if exists "Club members can view checkpoint checkins" on public.checkpoint_checkins;
create policy "Club members can view checkpoint checkins"
on public.checkpoint_checkins for select to authenticated
using (
  exists (
    select 1
    from public.reading_checkpoints rc
    join public.club_books cb on cb.id=rc.club_book_id
    where rc.id=checkpoint_checkins.checkpoint_id
      and public.is_club_member(cb.club_id)
  )
);

revoke all on public.checkpoint_checkins from anon;
grant select on public.checkpoint_checkins to authenticated;

create or replace function public.set_checkpoint_checkin(target_checkpoint_id uuid,target_status text)
returns public.checkpoint_checkins
language plpgsql
security definer
set search_path=public
as $$
declare
  uid uuid:=auth.uid();
  cid uuid;
  out_row public.checkpoint_checkins;
begin
  if uid is null then raise exception 'You must be signed in'; end if;
  if target_status not in ('reached','catching_up','not_yet') then raise exception 'Invalid checkpoint status'; end if;
  select cb.club_id into cid
  from public.reading_checkpoints rc join public.club_books cb on cb.id=rc.club_book_id
  where rc.id=target_checkpoint_id;
  if cid is null then raise exception 'Checkpoint not found'; end if;
  if not public.is_club_member(cid) then raise exception 'Not a club member'; end if;
  insert into public.checkpoint_checkins(checkpoint_id,user_id,status,updated_at)
  values(target_checkpoint_id,uid,target_status,now())
  on conflict(checkpoint_id,user_id) do update set status=excluded.status,updated_at=now()
  returning * into out_row;
  return out_row;
end $$;
revoke all on function public.set_checkpoint_checkin(uuid,text) from public,anon;
grant execute on function public.set_checkpoint_checkin(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Ballot deadlines, runoff, automation, and suggested plan draft
-- ---------------------------------------------------------------------------
alter table public.ballots
  add column if not exists parent_ballot_id uuid references public.ballots(id) on delete set null,
  add column if not exists round smallint not null default 1,
  add column if not exists finalized_at timestamptz;
create index if not exists ballots_closes_open_idx on public.ballots(closes_at) where status='open';

alter table public.club_books
  add column if not exists suggested_reading_plan jsonb;

drop function if exists public.start_ballot_from_ideas(uuid);
create or replace function public.start_ballot_from_ideas(target_club_id uuid,requested_closes_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  uid uuid:=auth.uid();
  new_ballot_id uuid;
  idea_count integer;
  deadline timestamptz:=coalesce(requested_closes_at,now()+interval '5 days');
begin
  if uid is null then raise exception 'You must be signed in'; end if;
  if not exists(select 1 from public.club_members cm where cm.club_id=target_club_id and cm.user_id=uid and cm.role in ('owner','admin'))
     and not exists(select 1 from public.clubs c where c.id=target_club_id and c.owner_id=uid) then
    raise exception 'Only a club owner or admin can start the vote';
  end if;
  if deadline<=now()+interval '15 minutes' then raise exception 'Voting deadline must be in the future'; end if;
  if deadline>now()+interval '30 days' then raise exception 'Voting deadline is too far away'; end if;
  select id into new_ballot_id from public.ballots where club_id=target_club_id and status in ('open','needs_decision') order by created_at desc limit 1;
  if new_ballot_id is not null then return new_ballot_id; end if;
  select count(*) into idea_count from public.club_books where club_id=target_club_id and status in ('idea','nominated');
  if idea_count<2 then raise exception 'Add at least two books before starting a vote'; end if;
  insert into public.ballots(club_id,status,opens_at,closes_at,created_by,round)
  values(target_club_id,'open',now(),deadline,uid,1) returning id into new_ballot_id;
  insert into public.nominations(club_id,book_id,nominated_by,ballot_id)
  select target_club_id,cb.book_id,coalesce(cb.created_by,uid),new_ballot_id
  from public.club_books cb where cb.club_id=target_club_id and cb.status in ('idea','nominated');
  update public.club_books set status='ballot' where club_id=target_club_id and status in ('idea','nominated');
  update public.clubs set status='choosing' where id=target_club_id;
  return new_ballot_id;
end $$;
revoke all on function public.start_ballot_from_ideas(uuid,timestamptz) from public,anon;
grant execute on function public.start_ballot_from_ideas(uuid,timestamptz) to authenticated;

-- Keep the original one-argument contract for older clients and the base release gate.
create or replace function public.start_ballot_from_ideas(target_club_id uuid)
returns uuid
language sql
security definer
set search_path=public
as $$
  select public.start_ballot_from_ideas(target_club_id,null::timestamptz)
$$;
revoke all on function public.start_ballot_from_ideas(uuid) from public,anon;
grant execute on function public.start_ballot_from_ideas(uuid) to authenticated;

create or replace function public.apply_ballot_winner(target_ballot_id uuid,target_book_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  cid uuid;
  actor uuid;
  winner_club_book_id uuid;
  cb_row public.club_books;
  book_pages integer;
  plan_basis text;
  plan_total integer;
begin
  select club_id,created_by into cid,actor from public.ballots where id=target_ballot_id;
  if cid is null then raise exception 'Ballot not found'; end if;
  if not exists(select 1 from public.nominations n where n.ballot_id=target_ballot_id and n.book_id=target_book_id) then
    raise exception 'Book is not on this ballot';
  end if;
  select * into cb_row from public.club_books where club_id=cid and book_id=target_book_id order by created_at desc limit 1;
  if cb_row.id is null then
    insert into public.club_books(club_id,book_id,status,created_by)
    values(cid,target_book_id,'acquiring',actor) returning * into cb_row;
  else
    update public.club_books set status='acquiring' where id=cb_row.id returning * into cb_row;
  end if;
  winner_club_book_id:=cb_row.id;
  select page_count into book_pages from public.books where id=target_book_id;
  plan_basis:=case when cb_row.total_chapters is not null then 'chapters' when coalesce(cb_row.total_pages,book_pages) is not null then 'pages' else 'duration' end;
  plan_total:=case when cb_row.total_chapters is not null then cb_row.total_chapters else coalesce(cb_row.total_pages,book_pages) end;
  update public.club_books
  set suggested_reading_plan=jsonb_build_object(
        'generatedAt',now(),
        'durationDays',28,
        'checkpointCount',4,
        'basis',plan_basis,
        'total',plan_total,
        'checkpoints',case
          when plan_basis='chapters' then jsonb_build_array(
            jsonb_build_object('day',7,'targetChapter',greatest(1,ceil(plan_total*0.25)::integer)),
            jsonb_build_object('day',14,'targetChapter',greatest(1,ceil(plan_total*0.50)::integer)),
            jsonb_build_object('day',21,'targetChapter',greatest(1,ceil(plan_total*0.75)::integer)),
            jsonb_build_object('day',28,'targetChapter',plan_total)
          )
          when plan_basis='pages' then jsonb_build_array(
            jsonb_build_object('day',7,'targetPage',greatest(1,ceil(plan_total*0.25)::integer)),
            jsonb_build_object('day',14,'targetPage',greatest(1,ceil(plan_total*0.50)::integer)),
            jsonb_build_object('day',21,'targetPage',greatest(1,ceil(plan_total*0.75)::integer)),
            jsonb_build_object('day',28,'targetPage',plan_total)
          )
          else jsonb_build_array(
            jsonb_build_object('day',7,'progressPercent',25),
            jsonb_build_object('day',14,'progressPercent',50),
            jsonb_build_object('day',21,'progressPercent',75),
            jsonb_build_object('day',28,'progressPercent',100)
          )
        end
      )
  where id=winner_club_book_id;
  update public.club_books set status='idea' where club_id=cid and status='ballot' and id<>winner_club_book_id;
  update public.ballots set status='closed',closes_at=coalesce(closes_at,now()),finalized_at=now() where id=target_ballot_id;
  update public.clubs set status='acquiring' where id=cid;
  return winner_club_book_id;
end $$;
revoke all on function public.apply_ballot_winner(uuid,uuid) from public,anon,authenticated;

create or replace function public.resolve_ballot(target_ballot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  ballot_row public.ballots;
  pref_count integer;
  top_support bigint;
  top_score bigint;
  top_strong bigint;
  top_votes bigint;
  tied_books uuid[];
  runoff_id uuid;
  winner_id uuid;
  winner_club_book uuid;
begin
  select * into ballot_row from public.ballots where id=target_ballot_id;
  if ballot_row.id is null or ballot_row.status<>'open' then return jsonb_build_object('kind','ignored'); end if;
  select count(*) into pref_count from public.ballot_preferences where ballot_id=target_ballot_id;
  if pref_count>0 then
    with stats as (
      select n.book_id,
        count(*) filter(where bp.preference in ('strong_yes','okay')) as support,
        coalesce(sum(case bp.preference when 'strong_yes' then 3 when 'okay' then 1 when 'no' then -2 else 0 end),0) as score,
        count(*) filter(where bp.preference='strong_yes') as strong_yes
      from public.nominations n left join public.ballot_preferences bp on bp.nomination_id=n.id
      where n.ballot_id=target_ballot_id group by n.book_id
    ) select support,score,strong_yes into top_support,top_score,top_strong from stats order by support desc,score desc,strong_yes desc limit 1;
    if coalesce(top_support,0)=0 and coalesce(top_score,0)<=0 then
      update public.ballots set status='needs_decision',finalized_at=now() where id=target_ballot_id;
      return jsonb_build_object('kind','needs_decision','reason','no_support');
    end if;
    with stats as (
      select n.book_id,
        count(*) filter(where bp.preference in ('strong_yes','okay')) as support,
        coalesce(sum(case bp.preference when 'strong_yes' then 3 when 'okay' then 1 when 'no' then -2 else 0 end),0) as score,
        count(*) filter(where bp.preference='strong_yes') as strong_yes
      from public.nominations n left join public.ballot_preferences bp on bp.nomination_id=n.id
      where n.ballot_id=target_ballot_id group by n.book_id
    ) select array_agg(book_id order by book_id) into tied_books from stats where support=top_support and score=top_score and strong_yes=top_strong;
  else
    with stats as (
      select n.book_id,count(v.nomination_id)::bigint vote_count
      from public.nominations n left join public.votes v on v.nomination_id=n.id
      where n.ballot_id=target_ballot_id group by n.book_id
    ) select max(vote_count) into top_votes from stats;
    if coalesce(top_votes,0)=0 then
      update public.ballots set status='needs_decision',finalized_at=now() where id=target_ballot_id;
      return jsonb_build_object('kind','needs_decision','reason','no_votes');
    end if;
    with stats as (
      select n.book_id,count(v.nomination_id)::bigint vote_count
      from public.nominations n left join public.votes v on v.nomination_id=n.id
      where n.ballot_id=target_ballot_id group by n.book_id
    ) select array_agg(book_id order by book_id) into tied_books from stats where vote_count=top_votes;
  end if;

  if coalesce(array_length(tied_books,1),0)=1 then
    winner_id:=tied_books[1];
    winner_club_book:=public.apply_ballot_winner(target_ballot_id,winner_id);
    return jsonb_build_object('kind','winner','clubBookId',winner_club_book,'bookId',winner_id);
  end if;

  if ballot_row.round>=2 then
    update public.ballots set status='needs_decision',finalized_at=now() where id=target_ballot_id;
    insert into public.notifications(user_id,club_id,type,title,body,deep_link)
    select cm.user_id,ballot_row.club_id,'ballot_admin_decision','Runoff tied','The runoff ended tied. An admin needs to choose the club pick.',
           '/clubs/'||ballot_row.club_id::text||'?ballot='||target_ballot_id::text
    from public.club_members cm where cm.club_id=ballot_row.club_id;
    return jsonb_build_object('kind','needs_decision','reason','runoff_tie');
  end if;

  update public.ballots set status='closed',finalized_at=now() where id=target_ballot_id;
  insert into public.ballots(club_id,status,opens_at,closes_at,created_by,parent_ballot_id,round)
  values(ballot_row.club_id,'open',now(),now()+interval '24 hours',ballot_row.created_by,target_ballot_id,ballot_row.round+1)
  returning id into runoff_id;
  insert into public.nominations(club_id,book_id,nominated_by,ballot_id)
  select ballot_row.club_id,n.book_id,n.nominated_by,runoff_id
  from public.nominations n where n.ballot_id=target_ballot_id and n.book_id=any(tied_books);
  insert into public.notifications(user_id,club_id,type,title,body,deep_link)
  select cm.user_id,ballot_row.club_id,'ballot_runoff','Runoff vote is open','The vote tied. Vote again between the tied books; this runoff closes in 24 hours.',
         '/clubs/'||ballot_row.club_id::text||'?ballot='||runoff_id::text
  from public.club_members cm where cm.club_id=ballot_row.club_id;
  return jsonb_build_object('kind','runoff','ballotId',runoff_id);
end $$;
revoke all on function public.resolve_ballot(uuid) from public,anon,authenticated;

create or replace function public.finalize_ballot(target_ballot_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  cid uuid;
  result jsonb;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select club_id into cid from public.ballots where id=target_ballot_id and status='open';
  if cid is null then raise exception 'Open ballot not found'; end if;
  if not exists(select 1 from public.club_members cm where cm.club_id=cid and cm.user_id=auth.uid() and cm.role in ('owner','admin'))
     and not exists(select 1 from public.clubs c where c.id=cid and c.owner_id=auth.uid()) then
    raise exception 'Only a club owner or admin can close the vote';
  end if;
  result:=public.resolve_ballot(target_ballot_id);
  if result->>'kind'='winner' then return (result->>'clubBookId')::uuid; end if;
  return null;
end $$;
revoke all on function public.finalize_ballot(uuid) from public,anon;
grant execute on function public.finalize_ballot(uuid) to authenticated;

create or replace function public.decide_tied_ballot(target_ballot_id uuid,target_nomination_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare cid uuid; bid uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select club_id into cid from public.ballots where id=target_ballot_id and status='needs_decision';
  if cid is null then raise exception 'Ballot is not waiting for an admin decision'; end if;
  if not exists(select 1 from public.club_members cm where cm.club_id=cid and cm.user_id=auth.uid() and cm.role in ('owner','admin'))
     and not exists(select 1 from public.clubs c where c.id=cid and c.owner_id=auth.uid()) then
    raise exception 'Only a club owner or admin can decide the tie';
  end if;
  select book_id into bid from public.nominations where id=target_nomination_id and ballot_id=target_ballot_id;
  if bid is null then raise exception 'Book is not on this ballot'; end if;
  return public.apply_ballot_winner(target_ballot_id,bid);
end $$;
revoke all on function public.decide_tied_ballot(uuid,uuid) from public,anon;
grant execute on function public.decide_tied_ballot(uuid,uuid) to authenticated;

create or replace function public.process_ballot_automation()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare r record; processed integer:=0; reminders integer:=0;
begin
  insert into public.notifications(user_id,club_id,type,title,body,deep_link)
  select cm.user_id,b.club_id,'ballot_closing','Voting closes tomorrow','Your club vote closes in about 24 hours.',
         '/clubs/'||b.club_id::text||'?ballot='||b.id::text
  from public.ballots b join public.club_members cm on cm.club_id=b.club_id
  where b.status='open' and b.closes_at>now()+interval '23 hours 45 minutes' and b.closes_at<=now()+interval '24 hours 15 minutes'
    and not exists(
      select 1 from public.notifications n
      where n.user_id=cm.user_id and n.type='ballot_closing'
        and n.deep_link='/clubs/'||b.club_id::text||'?ballot='||b.id::text
    );
  get diagnostics reminders=row_count;
  for r in select id from public.ballots where status='open' and closes_at is not null and closes_at<=now() order by closes_at
  loop
    perform public.resolve_ballot(r.id);
    processed:=processed+1;
  end loop;
  return jsonb_build_object('processed',processed,'reminders',reminders);
end $$;
revoke all on function public.process_ballot_automation() from public,anon,authenticated;
grant execute on function public.process_ballot_automation() to service_role;

-- ---------------------------------------------------------------------------
-- 3) Reading-plan Google Calendar sync records
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_plan_syncs(
  user_id uuid not null references auth.users(id) on delete cascade,
  club_book_id uuid not null references public.club_books(id) on delete cascade,
  enabled boolean not null default true,
  last_synced_at timestamptz,
  primary key(user_id,club_book_id)
);
alter table public.calendar_plan_syncs enable row level security;
revoke all on public.calendar_plan_syncs from anon,authenticated;

create table if not exists public.calendar_plan_event_links(
  user_id uuid not null references auth.users(id) on delete cascade,
  club_book_id uuid not null references public.club_books(id) on delete cascade,
  event_key text not null,
  checkpoint_id uuid references public.reading_checkpoints(id) on delete set null,
  google_event_id text not null,
  html_link text,
  last_synced_at timestamptz not null default now(),
  primary key(user_id,club_book_id,event_key)
);
alter table public.calendar_plan_event_links enable row level security;
revoke all on public.calendar_plan_event_links from anon,authenticated;

-- ---------------------------------------------------------------------------
-- 4) User timezone preference
-- ---------------------------------------------------------------------------
alter table public.user_preferences add column if not exists timezone text;

create or replace function public.set_my_timezone(target_timezone text)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if target_timezone is null or length(target_timezone)<1 or length(target_timezone)>100 then raise exception 'Invalid timezone'; end if;
  insert into public.user_preferences(user_id,timezone,updated_at)
  values(auth.uid(),target_timezone,now())
  on conflict(user_id) do update set timezone=excluded.timezone,updated_at=now();
end $$;
revoke all on function public.set_my_timezone(text) from public,anon;
grant execute on function public.set_my_timezone(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime registration
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='checkpoint_checkins') then
    alter publication supabase_realtime add table public.checkpoint_checkins;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- Launch verification for migration 012. Run alongside book_club_release_check().
-- ---------------------------------------------------------------------------
create or replace function public.book_club_launch_012_check()
returns table(check_name text,status text,detail text)
language plpgsql
security definer
set search_path=public,auth
as $$
declare n bigint; missing_rpc text; required_rpc text[]:=array[
  'set_checkpoint_checkin(uuid,text)',
  'start_ballot_from_ideas(uuid,timestamptz)',
  'decide_tied_ballot(uuid,uuid)',
  'set_my_timezone(text)',
  'process_ballot_automation()'
];
begin
  select count(*) into n
  from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
  where ns.nspname='public' and c.relname in ('checkpoint_checkins','calendar_plan_syncs','calendar_plan_event_links') and not c.relrowsecurity;
  return query select '012 RLS',case when n=0 then 'PASS' else 'FAIL' end,n||' new private tables have RLS disabled';

  select count(*) into n
  from information_schema.role_table_grants
  where table_schema='public' and grantee='anon' and table_name in ('checkpoint_checkins','calendar_plan_syncs','calendar_plan_event_links')
    and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');
  return query select '012 anonymous grants',case when n=0 then 'PASS' else 'FAIL' end,n||' new private CRUD grants exposed to anon';

  select string_agg(x,', ') into missing_rpc from unnest(required_rpc)x where to_regprocedure('public.'||x) is null;
  return query select '012 required RPCs',case when missing_rpc is null then 'PASS' else 'FAIL' end,coalesce('missing: '||missing_rpc,'all 012 RPCs present');

  select count(*) into n
  from information_schema.columns
  where table_schema='public' and table_name='user_preferences' and column_name='timezone';
  return query select 'timezone preference',case when n=1 then 'PASS' else 'FAIL' end,case when n=1 then 'timezone column present' else 'timezone column missing' end;

  select count(*) into n
  from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public' and tablename='checkpoint_checkins';
  return query select 'checkpoint realtime',case when n=1 then 'PASS' else 'FAIL' end,case when n=1 then 'checkpoint check-ins published' else 'checkpoint check-ins missing from realtime publication' end;
end;
$$;
revoke all on function public.book_club_launch_012_check() from public,anon,authenticated;

notify pgrst, 'reload schema';
-- RELEASE GATE: both checks should return only PASS rows after migration 012 is applied.
select * from public.book_club_release_check();
select * from public.book_club_launch_012_check();
