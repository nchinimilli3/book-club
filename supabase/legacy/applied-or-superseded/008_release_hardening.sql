-- BOOK CLUB migration 008 — release hardening + final runtime contracts
-- Idempotent. Run after 007. This closes known frontend/backend drift and adds
-- the remaining runtime primitives used by the release candidate.

begin;

create extension if not exists pgcrypto;
grant usage on schema public to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Canonical columns used by the current frontend
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists profile_style jsonb not null default '{"palette":"rose","layout":"scrapbook","note":"","stickers":[]}'::jsonb;

alter table public.books
  add column if not exists first_publish_year integer,
  add column if not exists page_count integer,
  add column if not exists description text,
  add column if not exists cover_url text,
  add column if not exists isbn13 text;

alter table public.reading_progress
  add column if not exists status text not null default 'reading',
  add column if not exists percent numeric(5,2),
  add column if not exists updated_at timestamptz not null default now();

alter table public.posts
  add column if not exists post_type text,
  add column if not exists spoiler_chapter integer,
  add column if not exists locked boolean not null default false,
  add column if not exists edited_at timestamptz;

-- Copy compatible legacy fields into the canonical runtime fields when they exist.
do $$
begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='books' and column_name='published_year') then
    execute 'update public.books set first_publish_year=coalesce(first_publish_year,published_year) where first_publish_year is null';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='reading_progress' and column_name='participation_status') then
    execute 'update public.reading_progress set status=coalesce(participation_status,''reading'') where participation_status is not null';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='posts' and column_name='type') then
    execute 'update public.posts set post_type=coalesce(post_type,type,''thought'') where post_type is null';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='posts' and column_name='chapter') then
    execute 'update public.posts set spoiler_chapter=coalesce(spoiler_chapter,chapter) where spoiler_chapter is null';
  end if;
end $$;

update public.posts set post_type='thought' where post_type is null or post_type not in ('thought','quote','question','prediction');
alter table public.posts alter column post_type set default 'thought';
alter table public.posts alter column post_type set not null;

update public.reading_progress set status='reading' where status is null or status not in ('reading','finished','catching_up','sitting_out','dnf');
do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid='public.reading_progress'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%status%'
  loop if pg_get_constraintdef((select oid from pg_constraint where conname=r.conname and conrelid='public.reading_progress'::regclass limit 1)) ilike '%status%' then execute format('alter table public.reading_progress drop constraint %I',r.conname); end if; end loop;
end $$;
alter table public.reading_progress add constraint reading_progress_status_check check(status in ('reading','finished','catching_up','sitting_out','dnf'));

do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid='public.posts'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%post_type%'
  loop execute format('alter table public.posts drop constraint %I',r.conname); end loop;
end $$;
alter table public.posts add constraint posts_post_type_check check(post_type in ('thought','quote','question','prediction'));

alter table public.clubs
  add column if not exists status text not null default 'setup',
  add column if not exists accent_palette text default 'petal',
  add column if not exists cover_image_url text;

do $$
begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='clubs' and column_name='palette') then
    execute 'update public.clubs set accent_palette=coalesce(nullif(accent_palette,''petal''),palette,''petal'') where palette is not null';
  end if;
end $$;

-- Normalize club state checks so the frontend state machine and database agree.
update public.clubs set status='planning_meeting' where status='planning';
update public.clubs set status='setup' where status is null or status not in ('setup','choosing','acquiring','reading','planning_meeting','meeting','rating','archived','paused');

do $$
declare r record;
begin
  for r in select conname from pg_constraint
           where conrelid='public.clubs'::regclass and contype='c'
             and pg_get_constraintdef(oid) ilike '%status%'
  loop execute format('alter table public.clubs drop constraint %I',r.conname); end loop;
end $$;
alter table public.clubs
  add constraint clubs_status_check check(status in ('setup','choosing','acquiring','reading','planning_meeting','meeting','rating','archived','paused'));

alter table public.club_books
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists start_date date,
  add column if not exists target_finish_date date,
  add column if not exists total_chapters integer,
  add column if not exists total_pages integer,
  add column if not exists reading_plan_mode text default 'suggested';

do $$
begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_books' and column_name='started_at') then
    execute 'update public.club_books set start_date=coalesce(start_date,started_at::date) where start_date is null';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='club_books' and column_name='target_finish_at') then
    execute 'update public.club_books set target_finish_date=coalesce(target_finish_date,target_finish_at::date) where target_finish_date is null';
  end if;
end $$;

update public.club_books set status='finished' where status='complete';
update public.club_books set status='idea' where status is null or status not in ('idea','nominated','ballot','up_next','acquiring','reading','planning','planning_meeting','meeting','rating','finished','dnf','archived');

do $$
declare r record;
begin
  for r in select conname from pg_constraint
           where conrelid='public.club_books'::regclass and contype='c'
             and pg_get_constraintdef(oid) ilike '%status%'
  loop execute format('alter table public.club_books drop constraint %I',r.conname); end loop;
end $$;
alter table public.club_books
  add constraint club_books_status_check check(status in ('idea','nominated','ballot','up_next','acquiring','reading','planning','planning_meeting','meeting','rating','finished','dnf','archived'));

alter table public.meetings
  add column if not exists meeting_url text,
  add column if not exists meeting_type text not null default 'facetime',
  add column if not exists status text not null default 'scheduled',
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.personal_books
  add column if not exists is_favorite boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  deep_link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user_created on public.notifications(user_id,created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "Users can view their notifications" on public.notifications;
create policy "Users can view their notifications" on public.notifications for select to authenticated using(user_id=auth.uid());
drop policy if exists "Users can mark their notifications read" on public.notifications;
create policy "Users can mark their notifications read" on public.notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

-- Copy a legacy join_url into the canonical meeting_url column when the former exists.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='meetings' and column_name='join_url'
  ) then
    execute 'update public.meetings set meeting_url = coalesce(meeting_url, join_url) where meeting_url is null';
  end if;
end $$;

-- Existing accounts/profiles/preferences.
insert into public.profiles(id, display_name, username)
select u.id,
       coalesce(nullif(u.raw_user_meta_data->>'display_name',''), nullif(u.raw_user_meta_data->>'full_name',''), split_part(u.email,'@',1), 'Reader'),
       split_part(coalesce(u.email,'reader'),'@',1) || '_' || substr(u.id::text,1,6)
from auth.users u
where not exists (select 1 from public.profiles p where p.id=u.id)
on conflict (id) do nothing;

insert into public.user_preferences(user_id)
select id from auth.users
on conflict (user_id) do nothing;

update public.user_preferences set notification_mode='essential' where notification_mode is null or notification_mode not in ('essential','all','quiet');
do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid='public.user_preferences'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%notification_mode%'
  loop execute format('alter table public.user_preferences drop constraint %I',r.conname); end loop;
end $$;
alter table public.user_preferences add constraint user_preferences_notification_mode_check check(notification_mode in ('essential','all','quiet'));

-- Every club owner must also be a club member.
insert into public.club_members(club_id,user_id,role)
select c.id,c.owner_id,'owner'
from public.clubs c
where not exists (
  select 1 from public.club_members cm where cm.club_id=c.id and cm.user_id=c.owner_id
)
on conflict (club_id,user_id) do update set role='owner';

-- An active preference may only point at a club the user still belongs to.
update public.user_preferences up
set active_club_id=null, updated_at=now()
where active_club_id is not null
  and not exists (
    select 1 from public.club_members cm
    where cm.club_id=up.active_club_id and cm.user_id=up.user_id
  );

-- ---------------------------------------------------------------------------
-- 2. Core RPC contracts used by the frontend
-- ---------------------------------------------------------------------------
create or replace function public.set_active_club(target_club_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_club_member(target_club_id) then raise exception 'You are not a member of this club'; end if;
  insert into public.user_preferences(user_id,active_club_id,updated_at)
  values(auth.uid(),target_club_id,now())
  on conflict(user_id) do update set active_club_id=excluded.active_club_id,updated_at=now();
end $$;
revoke all on function public.set_active_club(uuid) from public;
grant execute on function public.set_active_club(uuid) to authenticated;

create or replace function public.create_club(club_name text,palette text default 'petal',mark text default '')
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare cid uuid; clean_name text:=btrim(club_name); clean_palette text:=lower(coalesce(nullif(btrim(palette),''),'petal'));
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if length(clean_name)<1 or length(clean_name)>80 then raise exception 'Club name must be between 1 and 80 characters'; end if;
  if clean_palette not in ('petal','pink','rose','olive','butter','gold','lavender','plum','sky','blue','wine','clay') then clean_palette:='petal'; end if;
  insert into public.clubs(name,owner_id,status,accent_palette) values(clean_name,auth.uid(),'setup',clean_palette) returning id into cid;
  insert into public.club_members(club_id,user_id,role) values(cid,auth.uid(),'owner') on conflict(club_id,user_id) do update set role='owner';
  insert into public.user_preferences(user_id,active_club_id,updated_at) values(auth.uid(),cid,now()) on conflict(user_id) do update set active_club_id=excluded.active_club_id,updated_at=now();
  return cid;
end $$;
revoke all on function public.create_club(text,text,text) from public;
grant execute on function public.create_club(text,text,text) to authenticated;

create or replace function public.join_club_by_invite(supplied_invite_code text)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare cid uuid; code text:=lower(btrim(supplied_invite_code));
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select id into cid from public.clubs where lower(invite_code)=code and archived_at is null limit 1;
  if cid is null then raise exception 'Invite not found or no longer valid'; end if;
  insert into public.club_members(club_id,user_id,role) values(cid,auth.uid(),'member') on conflict(club_id,user_id) do nothing;
  insert into public.user_preferences(user_id,active_club_id,updated_at) values(auth.uid(),cid,now()) on conflict(user_id) do update set active_club_id=excluded.active_club_id,updated_at=now();
  return cid;
end $$;
revoke all on function public.join_club_by_invite(text) from public;
grant execute on function public.join_club_by_invite(text) to authenticated;

create or replace function public.mark_book_acquired(target_club_book_id uuid,reading_format text default null,isbn text default null)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select club_id into cid from public.club_books where id=target_club_book_id;
  if cid is null or not public.is_club_member(cid) then raise exception 'Not a club member'; end if;
  insert into public.book_checkins(club_book_id,user_id,status,format,edition_isbn,checked_in_at,updated_at)
  values(target_club_book_id,auth.uid(),'acquired',nullif(reading_format,''),nullif(isbn,''),now(),now())
  on conflict(club_book_id,user_id) do update set status='acquired',format=excluded.format,edition_isbn=excluded.edition_isbn,checked_in_at=now(),updated_at=now();
end $$;
revoke all on function public.mark_book_acquired(uuid,text,text) from public;
grant execute on function public.mark_book_acquired(uuid,text,text) to authenticated;

create or replace function public.update_my_progress(target_club_book_id uuid,chapter_number integer default null,page_number integer default null,progress_percent numeric default null,reading_status text default 'reading')
returns public.reading_progress
language plpgsql
security definer
set search_path=public
as $$
declare cid uuid; row_out public.reading_progress;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select club_id into cid from public.club_books where id=target_club_book_id;
  if cid is null or not public.is_club_member(cid) then raise exception 'Not a club member'; end if;
  if chapter_number is not null and chapter_number<0 then raise exception 'Chapter cannot be negative'; end if;
  if page_number is not null and page_number<0 then raise exception 'Page cannot be negative'; end if;
  if progress_percent is not null and (progress_percent<0 or progress_percent>100) then raise exception 'Progress must be between 0 and 100'; end if;
  if reading_status not in ('reading','finished','catching_up','sitting_out','dnf') then raise exception 'Invalid reading status'; end if;
  insert into public.reading_progress(club_book_id,user_id,chapter,page,percent,status,updated_at)
  values(target_club_book_id,auth.uid(),chapter_number,page_number,progress_percent,reading_status,now())
  on conflict(club_book_id,user_id) do update set chapter=excluded.chapter,page=excluded.page,percent=excluded.percent,status=excluded.status,updated_at=now()
  returning * into row_out;
  return row_out;
end $$;
revoke all on function public.update_my_progress(uuid,integer,integer,numeric,text) from public;
grant execute on function public.update_my_progress(uuid,integer,integer,numeric,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Voting integrity
-- ---------------------------------------------------------------------------
-- Keep the newest open ballot if an earlier bug created more than one.
with ranked as (
  select id,row_number() over(partition by club_id order by created_at desc,id desc) rn
  from public.ballots where status='open'
)
update public.ballots b
set status='closed', closes_at=coalesce(b.closes_at,now())
from ranked r
where b.id=r.id and r.rn>1;

create unique index if not exists ballots_one_open_per_club
on public.ballots(club_id) where status='open';

-- Remove duplicate nominations for the exact same book/ballot if any exist.
delete from public.nominations a
using public.nominations b
where a.ctid < b.ctid
  and a.ballot_id is not null
  and a.ballot_id=b.ballot_id
  and a.book_id=b.book_id;

create unique index if not exists nominations_one_book_per_ballot
on public.nominations(ballot_id,book_id) where ballot_id is not null;

-- Direct-table writes must not bypass single-choice voting.
create or replace function public.enforce_one_vote_per_ballot()
returns trigger
language plpgsql
set search_path=public
as $$
declare target_ballot uuid;
begin
  select ballot_id into target_ballot from public.nominations where id=new.nomination_id;
  if target_ballot is null then raise exception 'Nomination is not attached to a ballot'; end if;
  if exists(
    select 1 from public.votes v
    join public.nominations n on n.id=v.nomination_id
    where v.user_id=new.user_id
      and n.ballot_id=target_ballot
      and v.nomination_id<>new.nomination_id
  ) then
    raise exception 'Only one vote is allowed per ballot';
  end if;
  return new;
end;
$$;

drop trigger if exists votes_one_per_ballot on public.votes;
create trigger votes_one_per_ballot
before insert or update on public.votes
for each row execute procedure public.enforce_one_vote_per_ballot();

-- Prevent future ambiguous current-reading states. Existing bad rows are reported
-- by release validation rather than silently rewriting a person's reading history.
create or replace function public.prevent_multiple_active_club_books()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.status in ('up_next','acquiring','reading','planning','planning_meeting','meeting','rating')
     and exists(
       select 1 from public.club_books cb
       where cb.club_id=new.club_id
         and cb.id<>new.id
         and cb.status in ('up_next','acquiring','reading','planning','planning_meeting','meeting','rating')
     ) then
    raise exception 'This club already has an active reading cycle';
  end if;
  return new;
end;
$$;

drop trigger if exists club_books_one_active_guard on public.club_books;
create trigger club_books_one_active_guard
before insert or update of status,club_id on public.club_books
for each row execute procedure public.prevent_multiple_active_club_books();

-- ---------------------------------------------------------------------------
-- 3. Reading plan supports chapter OR page based books
-- ---------------------------------------------------------------------------
create or replace function public.generate_reading_checkpoints(
  target_club_book_id uuid,
  checkpoint_count integer default 4
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  book_row public.club_books;
  i integer;
  due_date date;
  total_days integer;
  target_chapter integer;
  target_page integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into book_row from public.club_books where id=target_club_book_id;
  if book_row.id is null then raise exception 'Club book not found'; end if;
  if not public.is_club_member(book_row.club_id) then raise exception 'Not a member'; end if;
  if book_row.start_date is null or book_row.target_finish_date is null then
    raise exception 'Start and finish dates are required';
  end if;
  if book_row.total_chapters is null and book_row.total_pages is null then
    raise exception 'A chapter count or page count is required';
  end if;
  if checkpoint_count < 2 or checkpoint_count > 12 then raise exception 'Checkpoint count must be between 2 and 12'; end if;

  delete from public.reading_checkpoints where club_book_id=target_club_book_id;
  total_days := greatest(1,book_row.target_finish_date-book_row.start_date);

  for i in 1..checkpoint_count loop
    due_date := book_row.start_date + round(total_days::numeric*i/checkpoint_count)::integer;
    target_chapter := case when book_row.total_chapters is not null then ceil(book_row.total_chapters::numeric*i/checkpoint_count)::integer end;
    target_page := case when book_row.total_chapters is null and book_row.total_pages is not null then ceil(book_row.total_pages::numeric*i/checkpoint_count)::integer end;
    insert into public.reading_checkpoints(club_book_id,due_at,target_chapter,target_page,label)
    values(
      target_club_book_id,due_date,target_chapter,target_page,
      case when i=checkpoint_count then 'Finish'
           when target_chapter is not null then 'Through Chapter '||target_chapter
           else 'Through page '||target_page end
    );
  end loop;
end;
$$;
revoke all on function public.generate_reading_checkpoints(uuid,integer) from public;
grant execute on function public.generate_reading_checkpoints(uuid,integer) to authenticated;

-- Starting the reading plan is an owner/admin operation at the database layer too.
create or replace function public.start_club_book(
  target_club_book_id uuid,
  finish_date date,
  chapters integer default null,
  pages integer default null
)
returns public.club_books
language plpgsql
security definer
set search_path=public
as $$
declare target_book public.club_books;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into target_book from public.club_books where id=target_club_book_id;
  if target_book.id is null then raise exception 'Club book not found'; end if;
  if not (
    exists(select 1 from public.clubs c where c.id=target_book.club_id and c.owner_id=auth.uid())
    or exists(select 1 from public.club_members cm where cm.club_id=target_book.club_id and cm.user_id=auth.uid() and cm.role in ('owner','admin'))
  ) then raise exception 'Only a club owner or admin can start the reading plan'; end if;
  if finish_date<=current_date then raise exception 'Finish date must be in the future'; end if;
  if chapters is null and pages is null then raise exception 'Chapter count or page count is required'; end if;
  if chapters is not null and chapters<1 then raise exception 'Chapter count must be positive'; end if;
  if pages is not null and pages<1 then raise exception 'Page count must be positive'; end if;

  update public.club_books
  set status='reading',start_date=current_date,target_finish_date=finish_date,
      total_chapters=chapters,total_pages=pages
  where id=target_club_book_id
  returning * into target_book;
  update public.clubs set status='reading' where id=target_book.club_id;
  return target_book;
end;
$$;
revoke all on function public.start_club_book(uuid,date,integer,integer) from public;
grant execute on function public.start_club_book(uuid,date,integer,integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Meetings: one canonical save contract + three-state RSVP
-- ---------------------------------------------------------------------------
-- Normalize legacy yes/no values before tightening the constraint. Drop the old
-- check first so the conversion itself cannot violate yes/maybe/no-only schemas.
do $$
declare r record;
begin
  for r in select conname from pg_constraint
           where conrelid='public.meeting_rsvps'::regclass and contype='c'
             and pg_get_constraintdef(oid) ilike '%response%'
  loop execute format('alter table public.meeting_rsvps drop constraint %I',r.conname); end loop;
end $$;

update public.meeting_rsvps set response='going' where response='yes';
update public.meeting_rsvps set response='cant' where response='no';

alter table public.meeting_rsvps
  add constraint meeting_rsvps_response_check check(response in ('going','maybe','cant'));

-- Ensure one RSVP row per user/meeting even if an old table lacked the PK.
delete from public.meeting_rsvps a using public.meeting_rsvps b
where a.ctid<b.ctid and a.meeting_id=b.meeting_id and a.user_id=b.user_id;
create unique index if not exists meeting_rsvps_one_per_user on public.meeting_rsvps(meeting_id,user_id);

create or replace function public.save_club_meeting(
  target_club_id uuid,
  target_club_book_id uuid,
  target_meeting_id uuid,
  target_starts_at timestamptz,
  target_meeting_type text default 'facetime',
  target_meeting_url text default null
)
returns public.meetings
language plpgsql
security definer
set search_path=public
as $$
declare result_row public.meetings;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not (
    exists(select 1 from public.clubs c where c.id=target_club_id and c.owner_id=auth.uid())
    or exists(select 1 from public.club_members cm where cm.club_id=target_club_id and cm.user_id=auth.uid() and cm.role in ('owner','admin'))
  ) then raise exception 'Only a club owner or admin can schedule meetings'; end if;
  if target_starts_at<=now()-interval '5 minutes' then raise exception 'Meeting time must be in the future'; end if;
  if target_club_book_id is not null and not exists(select 1 from public.club_books where id=target_club_book_id and club_id=target_club_id) then
    raise exception 'Book does not belong to this club';
  end if;

  if target_meeting_id is not null then
    update public.meetings
    set club_book_id=target_club_book_id,starts_at=target_starts_at,
        meeting_type=target_meeting_type,meeting_url=nullif(target_meeting_url,''),
        status='scheduled',updated_at=now()
    where id=target_meeting_id and club_id=target_club_id
    returning * into result_row;
    if result_row.id is null then raise exception 'Meeting not found'; end if;
  else
    insert into public.meetings(club_id,club_book_id,starts_at,meeting_type,meeting_url,status,created_by,updated_at)
    values(target_club_id,target_club_book_id,target_starts_at,target_meeting_type,nullif(target_meeting_url,''),'scheduled',auth.uid(),now())
    returning * into result_row;
  end if;
  return result_row;
end;
$$;
revoke all on function public.save_club_meeting(uuid,uuid,uuid,timestamptz,text,text) from public;
grant execute on function public.save_club_meeting(uuid,uuid,uuid,timestamptz,text,text) to authenticated;

create or replace function public.set_meeting_rsvp(target_meeting_id uuid,target_response text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if target_response not in ('going','maybe','cant') then raise exception 'Invalid RSVP'; end if;
  select club_id into cid from public.meetings where id=target_meeting_id;
  if cid is null then raise exception 'Meeting not found'; end if;
  if not public.is_club_member(cid) then raise exception 'Not a club member'; end if;
  insert into public.meeting_rsvps(meeting_id,user_id,response)
  values(target_meeting_id,auth.uid(),target_response)
  on conflict(meeting_id,user_id) do update set response=excluded.response;
end;
$$;
revoke all on function public.set_meeting_rsvp(uuid,text) from public;
grant execute on function public.set_meeting_rsvp(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Discussion: replies, reactions, private notes, quotes
-- ---------------------------------------------------------------------------
create table if not exists public.replies(
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check(length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists replies_post_created_idx on public.replies(post_id,created_at);

create table if not exists public.reactions(
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists reactions_unique_user_reaction on public.reactions(post_id,user_id,reaction);

-- Preserve rows from the earliest frontend schema if those legacy tables still exist.
do $$
begin
  if to_regclass('public.post_replies') is not null then
    execute 'insert into public.replies(id,post_id,user_id,body,created_at) select id,post_id,user_id,body,created_at from public.post_replies on conflict(id) do nothing';
  end if;
  if to_regclass('public.post_reactions') is not null then
    execute 'insert into public.reactions(post_id,user_id,reaction,created_at) select post_id,user_id,reaction,created_at from public.post_reactions on conflict(post_id,user_id,reaction) do nothing';
  end if;
end $$;

create table if not exists public.private_notes(
  id uuid primary key default gen_random_uuid(),
  club_book_id uuid not null references public.club_books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check(length(btrim(body)) between 1 and 10000),
  chapter integer,
  page integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists private_notes_user_book_idx on public.private_notes(user_id,club_book_id,created_at desc);

alter table public.replies enable row level security;
alter table public.reactions enable row level security;
alter table public.private_notes enable row level security;
alter table public.saved_quotes enable row level security;

-- Replies follow the spoiler visibility of their parent post.
drop policy if exists "replies spoiler-safe read" on public.replies;
create policy "replies spoiler-safe read" on public.replies for select to authenticated
using (
  user_id=auth.uid() or exists(
    select 1 from public.posts p join public.club_books cb on cb.id=p.club_book_id
    where p.id=replies.post_id and public.is_club_member(cb.club_id)
      and (p.spoiler_chapter is null or p.spoiler_chapter<=coalesce((select rp.chapter from public.reading_progress rp where rp.club_book_id=p.club_book_id and rp.user_id=auth.uid() limit 1),0))
  )
);
drop policy if exists "replies own insert" on public.replies;
create policy "replies own insert" on public.replies for insert to authenticated
with check(user_id=auth.uid() and exists(select 1 from public.posts p join public.club_books cb on cb.id=p.club_book_id where p.id=replies.post_id and public.is_club_member(cb.club_id)));
drop policy if exists "replies own update" on public.replies;
create policy "replies own update" on public.replies for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists "replies own delete" on public.replies;
create policy "replies own delete" on public.replies for delete to authenticated using(user_id=auth.uid());

-- Reactions are visible only with a visible/member post and writable by their owner.
drop policy if exists "reactions spoiler-safe read" on public.reactions;
create policy "reactions spoiler-safe read" on public.reactions for select to authenticated
using (
  user_id=auth.uid() or exists(
    select 1 from public.posts p join public.club_books cb on cb.id=p.club_book_id
    where p.id=reactions.post_id and public.is_club_member(cb.club_id)
      and (p.spoiler_chapter is null or p.spoiler_chapter<=coalesce((select rp.chapter from public.reading_progress rp where rp.club_book_id=p.club_book_id and rp.user_id=auth.uid() limit 1),0))
  )
);
drop policy if exists "reactions own insert" on public.reactions;
create policy "reactions own insert" on public.reactions for insert to authenticated
with check(user_id=auth.uid() and exists(select 1 from public.posts p join public.club_books cb on cb.id=p.club_book_id where p.id=reactions.post_id and public.is_club_member(cb.club_id)));
drop policy if exists "reactions own delete" on public.reactions;
create policy "reactions own delete" on public.reactions for delete to authenticated using(user_id=auth.uid());

-- Notes are private. Shared thoughts/quotes belong in posts instead.
drop policy if exists "private notes own read" on public.private_notes;
create policy "private notes own read" on public.private_notes for select to authenticated using(user_id=auth.uid());
drop policy if exists "private notes own insert" on public.private_notes;
create policy "private notes own insert" on public.private_notes for insert to authenticated
with check(user_id=auth.uid() and exists(select 1 from public.club_books cb where cb.id=private_notes.club_book_id and public.is_club_member(cb.club_id)));
drop policy if exists "private notes own update" on public.private_notes;
create policy "private notes own update" on public.private_notes for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists "private notes own delete" on public.private_notes;
create policy "private notes own delete" on public.private_notes for delete to authenticated using(user_id=auth.uid());

-- Saved quotes in Your margins are private to the user. Sharing a quote is a post.
drop policy if exists "Members can view saved quotes" on public.saved_quotes;
drop policy if exists "saved quotes own read" on public.saved_quotes;
create policy "saved quotes own read" on public.saved_quotes for select to authenticated using(user_id=auth.uid());
drop policy if exists "saved quotes own delete" on public.saved_quotes;
create policy "saved quotes own delete" on public.saved_quotes for delete to authenticated using(user_id=auth.uid());

-- ---------------------------------------------------------------------------
-- 6. End-of-book lifecycle: rating -> archive -> choosing
-- ---------------------------------------------------------------------------
create or replace function public.finish_club_book(target_club_book_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select club_id into cid from public.club_books where id=target_club_book_id;
  if cid is null then raise exception 'Club book not found'; end if;
  if not (
    exists(select 1 from public.clubs where id=cid and owner_id=auth.uid())
    or exists(select 1 from public.club_members where club_id=cid and user_id=auth.uid() and role in ('owner','admin'))
  ) then raise exception 'Only a club owner or admin can finish the club read'; end if;
  update public.club_books set status='rating' where id=target_club_book_id;
  update public.clubs set status='rating' where id=cid;
end;
$$;
revoke all on function public.finish_club_book(uuid) from public;
grant execute on function public.finish_club_book(uuid) to authenticated;

create or replace function public.save_club_book_rating(
  target_club_book_id uuid,
  target_rating numeric,
  target_review text default null,
  target_recommend boolean default null
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if target_rating<0 or target_rating>5 then raise exception 'Rating must be between 0 and 5'; end if;
  select club_id into cid from public.club_books where id=target_club_book_id;
  if cid is null or not public.is_club_member(cid) then raise exception 'Not a club member'; end if;
  insert into public.book_ratings(club_book_id,user_id,rating,review,recommend,submitted_at)
  values(target_club_book_id,auth.uid(),target_rating,nullif(target_review,''),target_recommend,now())
  on conflict(club_book_id,user_id) do update
  set rating=excluded.rating,review=excluded.review,recommend=excluded.recommend,submitted_at=now();
end;
$$;
revoke all on function public.save_club_book_rating(uuid,numeric,text,boolean) from public;
grant execute on function public.save_club_book_rating(uuid,numeric,text,boolean) to authenticated;

create or replace function public.archive_club_book(target_club_book_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare cid uuid; archive_id uuid; next_issue integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select club_id into cid from public.club_books where id=target_club_book_id;
  if cid is null then raise exception 'Club book not found'; end if;
  if not (
    exists(select 1 from public.clubs where id=cid and owner_id=auth.uid())
    or exists(select 1 from public.club_members where club_id=cid and user_id=auth.uid() and role in ('owner','admin'))
  ) then raise exception 'Only a club owner or admin can archive a club read'; end if;

  select coalesce(max(ca.issue_number),0)+1 into next_issue
  from public.club_archives ca join public.club_books cb on cb.id=ca.club_book_id where cb.club_id=cid;

  insert into public.club_archives(club_book_id,issue_number)
  values(target_club_book_id,next_issue)
  on conflict(club_book_id) do update set issue_number=coalesce(public.club_archives.issue_number,excluded.issue_number)
  returning id into archive_id;

  update public.club_books set status='archived' where id=target_club_book_id;
  update public.clubs set status='choosing' where id=cid;
  return archive_id;
end;
$$;
revoke all on function public.archive_club_book(uuid) from public;
grant execute on function public.archive_club_book(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Settings / profile persistence / account lifecycle
-- ---------------------------------------------------------------------------
create or replace function public.save_my_profile_style_v3(style_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare uid uuid:=auth.uid(); persisted jsonb; sticker_count integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(coalesce(style_payload,'{}'::jsonb))<>'object' then raise exception 'Profile style must be an object'; end if;
  sticker_count:=case when jsonb_typeof(style_payload->'stickers')='array' then jsonb_array_length(style_payload->'stickers') else 0 end;
  if sticker_count>120 then raise exception 'Too many stickers on one profile'; end if;
  update public.profiles set profile_style=coalesce(style_payload,'{}'::jsonb),updated_at=now()
  where id=uid returning profile_style into persisted;
  if persisted is null then raise exception 'Profile not found'; end if;
  return persisted;
end;
$$;
revoke all on function public.save_my_profile_style_v3(jsonb) from public;
grant execute on function public.save_my_profile_style_v3(jsonb) to authenticated;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path=public,auth
as $$
declare uid uuid:=auth.uid(); c record; successor uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  for c in select id from public.clubs where owner_id=uid loop
    select cm.user_id into successor
    from public.club_members cm
    where cm.club_id=c.id and cm.user_id<>uid
    order by case cm.role when 'admin' then 0 else 1 end,cm.joined_at
    limit 1;
    if successor is null then
      delete from public.clubs where id=c.id;
    else
      update public.clubs set owner_id=successor where id=c.id;
      update public.club_members set role='owner' where club_id=c.id and user_id=successor;
    end if;
  end loop;
  delete from auth.users where id=uid;
end;
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. In-app notification engine
-- ---------------------------------------------------------------------------
create or replace function public.notification_allowed(target_user uuid,target_type text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select case coalesce((select notification_mode from public.user_preferences where user_id=target_user),'essential')
    when 'quiet' then target_type in ('reply','meeting')
    else true
  end
$$;
revoke all on function public.notification_allowed(uuid,text) from public;

create or replace function public.notify_on_reply()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare p public.posts; cb public.club_books; actor text;
begin
  select * into p from public.posts where id=new.post_id;
  if p.id is null or p.user_id=new.user_id then return new; end if;
  select * into cb from public.club_books where id=p.club_book_id;
  if cb.id is null or not public.notification_allowed(p.user_id,'reply') then return new; end if;
  select coalesce(display_name,'Someone') into actor from public.profiles where id=new.user_id;
  insert into public.notifications(user_id,club_id,type,title,body,deep_link)
  values(p.user_id,cb.club_id,'reply',actor||' replied to you',left(new.body,180),'/clubs/'||cb.club_id||'/books/'||cb.id);
  return new;
end $$;
drop trigger if exists notifications_reply_insert on public.replies;
create trigger notifications_reply_insert after insert on public.replies for each row execute procedure public.notify_on_reply();

create or replace function public.notify_on_ballot()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare club_name text;
begin
  if new.status<>'open' then return new; end if;
  select name into club_name from public.clubs where id=new.club_id;
  insert into public.notifications(user_id,club_id,type,title,body,deep_link)
  select cm.user_id,new.club_id,'vote','Voting is open',coalesce(club_name,'Your club')||' is choosing the next book.','/clubs/'||new.club_id
  from public.club_members cm
  where cm.club_id=new.club_id and cm.user_id<>new.created_by and public.notification_allowed(cm.user_id,'vote');
  return new;
end $$;
drop trigger if exists notifications_ballot_insert on public.ballots;
create trigger notifications_ballot_insert after insert on public.ballots for each row execute procedure public.notify_on_ballot();

create or replace function public.notify_on_meeting()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare actor uuid:=coalesce(auth.uid(),new.created_by); club_name text;
begin
  if tg_op='UPDATE' then
    if new.starts_at is not distinct from old.starts_at and new.meeting_url is not distinct from old.meeting_url and new.status is not distinct from old.status then return new; end if;
  end if;
  select name into club_name from public.clubs where id=new.club_id;
  insert into public.notifications(user_id,club_id,type,title,body,deep_link)
  select cm.user_id,new.club_id,'meeting',case when tg_op='INSERT' then 'Meeting scheduled' else 'Meeting updated' end,
         coalesce(club_name,'Your club')||' · '||to_char(new.starts_at at time zone 'UTC','Mon DD, HH24:MI')||' UTC','/clubs/'||new.club_id
  from public.club_members cm
  where cm.club_id=new.club_id and cm.user_id<>actor and public.notification_allowed(cm.user_id,'meeting');
  return new;
end $$;
drop trigger if exists notifications_meeting_change on public.meetings;
create trigger notifications_meeting_change after insert or update on public.meetings for each row execute procedure public.notify_on_meeting();

create or replace function public.notify_on_book_pick()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare book_title text;
begin
  if new.status<>'acquiring' then return new; end if;
  if tg_op='UPDATE' and old.status='acquiring' then return new; end if;
  select title into book_title from public.books where id=new.book_id;
  insert into public.notifications(user_id,club_id,type,title,body,deep_link)
  select cm.user_id,new.club_id,'book_pick','Next book picked',coalesce(book_title,'Your next book')||' is up next.','/clubs/'||new.club_id
  from public.club_members cm where cm.club_id=new.club_id and public.notification_allowed(cm.user_id,'book_pick');
  return new;
end $$;
drop trigger if exists notifications_book_pick on public.club_books;
create trigger notifications_book_pick after insert or update of status on public.club_books for each row execute procedure public.notify_on_book_pick();

-- ---------------------------------------------------------------------------
-- 9. Permissions and realtime
-- ---------------------------------------------------------------------------
grant select,insert,update,delete on public.replies,public.reactions,public.private_notes,public.saved_quotes,public.meeting_rsvps,public.book_ratings to authenticated;
grant select,insert,update on public.meetings,public.club_archives to authenticated;
grant select,update on public.profiles,public.user_preferences,public.notifications to authenticated;

-- Add new live tables to realtime if needed.
do $$
declare t text;
begin
  foreach t in array array['posts','replies','reactions','reading_progress','meeting_rsvps','meetings','club_books','book_ratings','ballots','notifications'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Final admin-only release validation function
-- ---------------------------------------------------------------------------
create or replace function public.book_club_release_check()
returns table(check_name text,status text,detail text)
language plpgsql
security definer
set search_path=public,auth
as $$
declare n bigint;
begin
  select count(*) into n from auth.users u where not exists(select 1 from public.profiles p where p.id=u.id);
  return query select 'auth profiles',case when n=0 then 'PASS' else 'FAIL' end,n||' auth users missing profiles';

  select count(*) into n from public.clubs c where not exists(select 1 from public.club_members cm where cm.club_id=c.id and cm.user_id=c.owner_id and cm.role='owner');
  return query select 'club owner membership',case when n=0 then 'PASS' else 'FAIL' end,n||' clubs have an invalid owner membership';

  select count(*) into n from public.user_preferences up where up.active_club_id is not null and not exists(select 1 from public.club_members cm where cm.club_id=up.active_club_id and cm.user_id=up.user_id);
  return query select 'active club preferences',case when n=0 then 'PASS' else 'FAIL' end,n||' preferences point to non-member clubs';

  select count(*) into n from (select club_id from public.ballots where status='open' group by club_id having count(*)>1) x;
  return query select 'one open ballot per club',case when n=0 then 'PASS' else 'FAIL' end,n||' clubs have duplicate open ballots';

  select count(*) into n from (
    select club_id from public.club_books
    where status in ('up_next','acquiring','reading','planning','planning_meeting','meeting','rating')
    group by club_id having count(*)>1
  ) x;
  return query select 'one active reading cycle',case when n=0 then 'PASS' else 'FAIL' end,n||' clubs have multiple active books; inspect these before launch';

  select count(*) into n from public.meeting_rsvps where response not in ('going','maybe','cant');
  return query select 'RSVP values',case when n=0 then 'PASS' else 'FAIL' end,n||' invalid RSVP rows';

  select count(*) into n from public.personal_books pb where pb.user_id is null or pb.book_id is null;
  return query select 'personal library references',case when n=0 then 'PASS' else 'FAIL' end,n||' invalid personal library rows';

  select count(*) into n from public.club_books cb left join public.books b on b.id=cb.book_id where b.id is null;
  return query select 'club book references',case when n=0 then 'PASS' else 'FAIL' end,n||' club book rows missing catalog books';

  select count(*) into n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
  where ns.nspname='public' and c.relname in ('profiles','clubs','club_members','club_books','posts','replies','reactions','meetings','meeting_rsvps','personal_books','private_notes','saved_quotes','notifications') and not c.relrowsecurity;
  return query select 'RLS on private tables',case when n=0 then 'PASS' else 'FAIL' end,n||' required private tables have RLS disabled';

  select count(*) into n from public.reading_progress where percent is not null and (percent<0 or percent>100);
  return query select 'reading progress range',case when n=0 then 'PASS' else 'FAIL' end,n||' progress rows fall outside 0 to 100';

  select count(*) into n from public.nominations n left join public.ballots b on b.id=n.ballot_id where n.ballot_id is not null and b.id is null;
  return query select 'ballot references',case when n=0 then 'PASS' else 'FAIL' end,n||' nominations point at missing ballots';

  select count(*) into n from public.replies r left join public.posts p on p.id=r.post_id where p.id is null;
  return query select 'reply references',case when n=0 then 'PASS' else 'FAIL' end,n||' replies point at missing posts';

  select count(*) into n from information_schema.role_table_grants where table_schema='public' and grantee='anon' and table_name in ('clubs','club_members','club_books','posts','replies','reactions','meetings','meeting_rsvps','personal_books','private_notes','saved_quotes','notifications') and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');
  return query select 'anonymous private-table grants',case when n=0 then 'PASS' else 'FAIL' end,n||' private table grants are exposed to anon';

  return query select 'required RPCs',
    case when to_regprocedure('public.start_ballot_from_ideas(uuid)') is not null
           and to_regprocedure('public.cast_ballot_vote(uuid)') is not null
           and to_regprocedure('public.finalize_ballot(uuid)') is not null
           and to_regprocedure('public.save_club_meeting(uuid,uuid,uuid,timestamptz,text,text)') is not null
           and to_regprocedure('public.save_my_profile_style_v3(jsonb)') is not null
         then 'PASS' else 'FAIL' end,
    'vote, meeting, and profile-style RPCs';
end;
$$;
revoke all on function public.book_club_release_check() from public,anon,authenticated;

commit;
notify pgrst,'reload schema';

-- When run in the Supabase SQL editor, the final result should be all PASS.
select * from public.book_club_release_check();
