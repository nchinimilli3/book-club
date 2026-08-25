
-- BOOK CLUB — CONSOLIDATED BACKEND PHASE 2
-- Safe to rerun. Assumes the core schema, helper functions, auth trigger,
-- create_club/join_club_by_invite, and core RLS from earlier steps already exist.

begin;

-- =========================================================
-- 1) CLUB / USER STATE
-- =========================================================

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_club_id uuid references public.clubs(id) on delete set null,
  notification_mode text not null default 'essential',
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "Users can view their own preferences" on public.user_preferences;
create policy "Users can view their own preferences"
on public.user_preferences for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can insert their own preferences" on public.user_preferences;
create policy "Users can insert their own preferences"
on public.user_preferences for insert to authenticated
with check (
  user_id = auth.uid()
  and (active_club_id is null or public.is_club_member(active_club_id))
);

drop policy if exists "Users can update their own preferences" on public.user_preferences;
create policy "Users can update their own preferences"
on public.user_preferences for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and (active_club_id is null or public.is_club_member(active_club_id))
);

alter table public.clubs
  add column if not exists cadence text default 'monthly',
  add column if not exists selection_method text default 'vote',
  add column if not exists meeting_style text default 'facetime',
  add column if not exists reading_pace text default 'normal',
  add column if not exists usual_meeting_day integer,
  add column if not exists usual_meeting_time time,
  add column if not exists paused_until date,
  add column if not exists cover_image_url text;

create or replace function public.handle_new_user_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_preferences_created on auth.users;
create trigger on_auth_user_preferences_created
after insert on auth.users
for each row execute procedure public.handle_new_user_preferences();

create or replace function public.set_active_club(target_club_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if not public.is_club_member(target_club_id) then
    raise exception 'You are not a member of this club';
  end if;

  insert into public.user_preferences(user_id, active_club_id, updated_at)
  values(auth.uid(), target_club_id, now())
  on conflict (user_id) do update
    set active_club_id = excluded.active_club_id,
        updated_at = now();
end;
$$;

revoke all on function public.set_active_club(uuid) from public;
grant execute on function public.set_active_club(uuid) to authenticated;

-- =========================================================
-- 2) BALLOTS / HIDDEN VOTING
-- =========================================================

create table if not exists public.ballots (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  status text not null default 'open',
  opens_at timestamptz not null default now(),
  closes_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.ballots enable row level security;

alter table public.nominations
  add column if not exists ballot_id uuid references public.ballots(id) on delete cascade;

create index if not exists idx_ballots_club on public.ballots(club_id);
create index if not exists idx_nominations_ballot on public.nominations(ballot_id);

drop policy if exists "Members can view ballots" on public.ballots;
create policy "Members can view ballots"
on public.ballots for select to authenticated
using (public.is_club_member(club_id));

drop policy if exists "Members can create ballots" on public.ballots;
create policy "Members can create ballots"
on public.ballots for insert to authenticated
with check (created_by = auth.uid() and public.is_club_member(club_id));

drop policy if exists "Club owners can update ballots" on public.ballots;
create policy "Club owners can update ballots"
on public.ballots for update to authenticated
using (public.is_club_owner(club_id))
with check (public.is_club_owner(club_id));

drop policy if exists "Members can view votes" on public.votes;
drop policy if exists "Users can view their own votes" on public.votes;
create policy "Users can view their own votes"
on public.votes for select to authenticated
using (user_id = auth.uid());

create or replace function public.get_ballot_results(target_ballot_id uuid)
returns table (nomination_id uuid, vote_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare ballot_record public.ballots;
begin
  select * into ballot_record from public.ballots where id = target_ballot_id;
  if ballot_record.id is null then raise exception 'Ballot not found'; end if;
  if not public.is_club_member(ballot_record.club_id) then raise exception 'Not a member'; end if;
  if ballot_record.status <> 'closed' then raise exception 'Results are hidden until voting closes'; end if;

  return query
  select n.id, count(v.id)
  from public.nominations n
  left join public.votes v on v.nomination_id = n.id
  where n.ballot_id = target_ballot_id
  group by n.id
  order by count(v.id) desc;
end;
$$;

revoke all on function public.get_ballot_results(uuid) from public;
grant execute on function public.get_ballot_results(uuid) to authenticated;

create or replace function public.select_ballot_winner(
  target_ballot_id uuid,
  winning_nomination_id uuid
)
returns public.club_books
language plpgsql
security definer
set search_path = public
as $$
declare
  ballot_record public.ballots;
  nomination_record public.nominations;
  new_club_book public.club_books;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select * into ballot_record from public.ballots where id = target_ballot_id;
  if ballot_record.id is null then raise exception 'Ballot not found'; end if;
  if not public.is_club_owner(ballot_record.club_id) then
    raise exception 'Only the club owner can confirm the winner';
  end if;

  select * into nomination_record
  from public.nominations
  where id = winning_nomination_id and ballot_id = target_ballot_id;

  if nomination_record.id is null then
    raise exception 'Nomination does not belong to this ballot';
  end if;

  update public.ballots
  set status = 'closed', closes_at = coalesce(closes_at, now())
  where id = target_ballot_id;

  insert into public.club_books(club_id, book_id, status)
  values(ballot_record.club_id, nomination_record.book_id, 'acquiring')
  returning * into new_club_book;

  update public.clubs set status = 'acquiring' where id = ballot_record.club_id;
  return new_club_book;
end;
$$;

revoke all on function public.select_ballot_winner(uuid, uuid) from public;
grant execute on function public.select_ballot_winner(uuid, uuid) to authenticated;

-- =========================================================
-- 3) ACQUISITION / READING PLAN / PROGRESS
-- =========================================================

create table if not exists public.book_checkins (
  club_book_id uuid not null references public.club_books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting',
  format text,
  edition_isbn text,
  checked_in_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (club_book_id, user_id)
);

alter table public.book_checkins enable row level security;

drop policy if exists "Members can view book checkins" on public.book_checkins;
create policy "Members can view book checkins"
on public.book_checkins for select to authenticated
using (
  exists (
    select 1 from public.club_books cb
    where cb.id = book_checkins.club_book_id
      and public.is_club_member(cb.club_id)
  )
);

drop policy if exists "Users can create their own book checkin" on public.book_checkins;
create policy "Users can create their own book checkin"
on public.book_checkins for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.club_books cb
    where cb.id = book_checkins.club_book_id
      and public.is_club_member(cb.club_id)
  )
);

drop policy if exists "Users can update their own book checkin" on public.book_checkins;
create policy "Users can update their own book checkin"
on public.book_checkins for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

alter table public.club_books
  add column if not exists start_date date,
  add column if not exists target_finish_date date,
  add column if not exists total_chapters integer,
  add column if not exists total_pages integer,
  add column if not exists reading_plan_mode text default 'suggested';

create table if not exists public.reading_checkpoints (
  id uuid primary key default gen_random_uuid(),
  club_book_id uuid not null references public.club_books(id) on delete cascade,
  due_at date not null,
  target_chapter integer,
  target_page integer,
  label text,
  created_at timestamptz not null default now()
);

alter table public.reading_checkpoints enable row level security;
create index if not exists idx_reading_checkpoints_club_book
on public.reading_checkpoints(club_book_id);

drop policy if exists "Members can view reading checkpoints" on public.reading_checkpoints;
create policy "Members can view reading checkpoints"
on public.reading_checkpoints for select to authenticated
using (
  exists (
    select 1 from public.club_books cb
    where cb.id = reading_checkpoints.club_book_id
      and public.is_club_member(cb.club_id)
  )
);

drop policy if exists "Members can create reading checkpoints" on public.reading_checkpoints;
create policy "Members can create reading checkpoints"
on public.reading_checkpoints for insert to authenticated
with check (
  exists (
    select 1 from public.club_books cb
    where cb.id = reading_checkpoints.club_book_id
      and public.is_club_member(cb.club_id)
  )
);

drop policy if exists "Members can update reading checkpoints" on public.reading_checkpoints;
create policy "Members can update reading checkpoints"
on public.reading_checkpoints for update to authenticated
using (
  exists (
    select 1 from public.club_books cb
    where cb.id = reading_checkpoints.club_book_id
      and public.is_club_member(cb.club_id)
  )
)
with check (
  exists (
    select 1 from public.club_books cb
    where cb.id = reading_checkpoints.club_book_id
      and public.is_club_member(cb.club_id)
  )
);

create or replace function public.mark_book_acquired(
  target_club_book_id uuid,
  reading_format text default null,
  isbn text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target_club_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select club_id into target_club_id
  from public.club_books where id = target_club_book_id;

  if target_club_id is null then raise exception 'Book not found'; end if;
  if not public.is_club_member(target_club_id) then raise exception 'Not a member'; end if;

  insert into public.book_checkins(
    club_book_id, user_id, status, format, edition_isbn, checked_in_at, updated_at
  )
  values(
    target_club_book_id, auth.uid(), 'acquired',
    reading_format, isbn, now(), now()
  )
  on conflict (club_book_id, user_id) do update
    set status = 'acquired',
        format = excluded.format,
        edition_isbn = excluded.edition_isbn,
        checked_in_at = now(),
        updated_at = now();
end;
$$;

revoke all on function public.mark_book_acquired(uuid, text, text) from public;
grant execute on function public.mark_book_acquired(uuid, text, text) to authenticated;

create or replace function public.get_acquisition_status(target_club_book_id uuid)
returns table (
  participating_members bigint,
  acquired_members bigint,
  everyone_has_book boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare target_club_id uuid;
begin
  select club_id into target_club_id from public.club_books where id = target_club_book_id;
  if target_club_id is null then raise exception 'Club book not found'; end if;
  if not public.is_club_member(target_club_id) then raise exception 'Not a member'; end if;

  return query
  with members as (
    select cm.user_id
    from public.club_members cm
    where cm.club_id = target_club_id
  ),
  acquired as (
    select bc.user_id
    from public.book_checkins bc
    where bc.club_book_id = target_club_book_id
      and bc.status = 'acquired'
  )
  select
    (select count(*) from members),
    (select count(*) from acquired),
    (
      (select count(*) from members) > 0
      and (select count(*) from members) = (select count(*) from acquired)
    );
end;
$$;

revoke all on function public.get_acquisition_status(uuid) from public;
grant execute on function public.get_acquisition_status(uuid) to authenticated;

create or replace function public.start_club_book(
  target_club_book_id uuid,
  finish_date date,
  chapters integer default null,
  pages integer default null
)
returns public.club_books
language plpgsql
security definer
set search_path = public
as $$
declare target_book public.club_books;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select * into target_book from public.club_books where id = target_club_book_id;
  if target_book.id is null then raise exception 'Club book not found'; end if;
  if not public.is_club_member(target_book.club_id) then raise exception 'Not a member'; end if;
  if finish_date <= current_date then raise exception 'Finish date must be in the future'; end if;

  update public.club_books
  set status = 'reading',
      start_date = current_date,
      target_finish_date = finish_date,
      started_at = now(),
      total_chapters = chapters,
      total_pages = pages
  where id = target_club_book_id
  returning * into target_book;

  update public.clubs set status = 'reading' where id = target_book.club_id;
  return target_book;
end;
$$;

revoke all on function public.start_club_book(uuid, date, integer, integer) from public;
grant execute on function public.start_club_book(uuid, date, integer, integer) to authenticated;

create or replace function public.update_my_progress(
  target_club_book_id uuid,
  chapter_number integer default null,
  page_number integer default null,
  progress_percent numeric default null,
  reading_status text default 'reading'
)
returns public.reading_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  target_club_id uuid;
  result_row public.reading_progress;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select club_id into target_club_id
  from public.club_books where id = target_club_book_id;

  if target_club_id is null then raise exception 'Club book not found'; end if;
  if not public.is_club_member(target_club_id) then raise exception 'Not a member'; end if;
  if progress_percent is not null and (progress_percent < 0 or progress_percent > 100) then
    raise exception 'Progress must be between 0 and 100';
  end if;

  if reading_status not in ('reading','finished','catching_up','sitting_out','dnf') then
    raise exception 'Invalid reading status';
  end if;

  insert into public.reading_progress(
    club_book_id, user_id, chapter, page, percent, status, updated_at
  )
  values(
    target_club_book_id, auth.uid(), chapter_number,
    page_number, progress_percent, reading_status, now()
  )
  on conflict (club_book_id, user_id) do update
    set chapter = excluded.chapter,
        page = excluded.page,
        percent = excluded.percent,
        status = excluded.status,
        updated_at = now()
  returning * into result_row;

  return result_row;
end;
$$;

revoke all on function public.update_my_progress(uuid, integer, integer, numeric, text) from public;
grant execute on function public.update_my_progress(uuid, integer, integer, numeric, text) to authenticated;

create or replace function public.generate_reading_checkpoints(
  target_club_book_id uuid,
  checkpoint_count integer default 4
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  book_row public.club_books;
  i integer;
  target_chapter integer;
  due_date date;
  total_days integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select * into book_row from public.club_books where id = target_club_book_id;
  if book_row.id is null then raise exception 'Club book not found'; end if;
  if not public.is_club_member(book_row.club_id) then raise exception 'Not a member'; end if;

  if book_row.start_date is null
     or book_row.target_finish_date is null
     or book_row.total_chapters is null then
    raise exception 'Start date, finish date, and total chapters are required';
  end if;

  if checkpoint_count < 2 then raise exception 'Need at least 2 checkpoints'; end if;

  delete from public.reading_checkpoints where club_book_id = target_club_book_id;
  total_days := book_row.target_finish_date - book_row.start_date;

  for i in 1..checkpoint_count loop
    target_chapter := ceil(book_row.total_chapters::numeric * i / checkpoint_count);
    due_date := book_row.start_date
      + round(total_days::numeric * i / checkpoint_count)::integer;

    insert into public.reading_checkpoints(
      club_book_id, due_at, target_chapter, label
    )
    values(
      target_club_book_id,
      due_date,
      target_chapter,
      case
        when i = checkpoint_count then 'Finish'
        else 'Through Chapter ' || target_chapter
      end
    );
  end loop;
end;
$$;

revoke all on function public.generate_reading_checkpoints(uuid, integer) from public;
grant execute on function public.generate_reading_checkpoints(uuid, integer) to authenticated;

-- =========================================================
-- 4) DISCUSSION / SPOILERS / PREDICTIONS / QUESTIONS / QUOTES
-- =========================================================

alter table public.posts
  add column if not exists locked boolean not null default false,
  add column if not exists edited_at timestamptz;

-- Enforce spoiler safety at the DB layer.
drop policy if exists "Members can view posts" on public.posts;

create policy "Members can view spoiler-safe posts"
on public.posts for select to authenticated
using (
  user_id = auth.uid()
  or (
    exists (
      select 1
      from public.club_books cb
      where cb.id = posts.club_book_id
        and public.is_club_member(cb.club_id)
    )
    and (
      spoiler_chapter is null
      or spoiler_chapter <= coalesce(
        (
          select rp.chapter
          from public.reading_progress rp
          where rp.club_book_id = posts.club_book_id
            and rp.user_id = auth.uid()
          limit 1
        ),
        0
      )
    )
  )
);

create or replace function public.prevent_locked_prediction_edits()
returns trigger
language plpgsql
as $$
begin
  if old.post_type = 'prediction' and old.locked = true then
    raise exception 'Locked predictions cannot be edited';
  end if;

  new.edited_at := now();
  return new;
end;
$$;

drop trigger if exists prevent_locked_prediction_edits on public.posts;
create trigger prevent_locked_prediction_edits
before update on public.posts
for each row execute procedure public.prevent_locked_prediction_edits();

create table if not exists public.meeting_questions (
  id uuid primary key default gen_random_uuid(),
  club_book_id uuid not null references public.club_books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  spoiler_chapter integer,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.saved_quotes (
  id uuid primary key default gen_random_uuid(),
  club_book_id uuid not null references public.club_books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  quote_text text not null,
  chapter integer,
  page integer,
  note text,
  created_at timestamptz not null default now()
);

alter table public.meeting_questions enable row level security;
alter table public.saved_quotes enable row level security;

drop policy if exists "Members can view meeting questions" on public.meeting_questions;
create policy "Members can view meeting questions"
on public.meeting_questions for select to authenticated
using (
  exists (
    select 1 from public.club_books cb
    where cb.id = meeting_questions.club_book_id
      and public.is_club_member(cb.club_id)
  )
);

drop policy if exists "Members can create meeting questions" on public.meeting_questions;
create policy "Members can create meeting questions"
on public.meeting_questions for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.club_books cb
    where cb.id = meeting_questions.club_book_id
      and public.is_club_member(cb.club_id)
  )
);

drop policy if exists "Users can update their own meeting questions" on public.meeting_questions;
create policy "Users can update their own meeting questions"
on public.meeting_questions for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Members can view saved quotes" on public.saved_quotes;
create policy "Members can view saved quotes"
on public.saved_quotes for select to authenticated
using (
  exists (
    select 1 from public.club_books cb
    where cb.id = saved_quotes.club_book_id
      and public.is_club_member(cb.club_id)
  )
);

drop policy if exists "Members can create saved quotes" on public.saved_quotes;
create policy "Members can create saved quotes"
on public.saved_quotes for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.club_books cb
    where cb.id = saved_quotes.club_book_id
      and public.is_club_member(cb.club_id)
  )
);

drop policy if exists "Users can update their own saved quotes" on public.saved_quotes;
create policy "Users can update their own saved quotes"
on public.saved_quotes for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.get_locked_post_count(target_club_book_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  target_club_id uuid;
  viewer_chapter integer;
  result_count bigint;
begin
  select club_id into target_club_id
  from public.club_books where id = target_club_book_id;

  if target_club_id is null then raise exception 'Club book not found'; end if;
  if not public.is_club_member(target_club_id) then raise exception 'Not a member'; end if;

  select coalesce(chapter, 0) into viewer_chapter
  from public.reading_progress
  where club_book_id = target_club_book_id and user_id = auth.uid();

  viewer_chapter := coalesce(viewer_chapter, 0);

  select count(*) into result_count
  from public.posts
  where club_book_id = target_club_book_id
    and user_id <> auth.uid()
    and spoiler_chapter is not null
    and spoiler_chapter > viewer_chapter;

  return result_count;
end;
$$;

revoke all on function public.get_locked_post_count(uuid) from public;
grant execute on function public.get_locked_post_count(uuid) to authenticated;

-- =========================================================
-- 5) RATINGS / ARCHIVE
-- =========================================================

create table if not exists public.book_ratings (
  club_book_id uuid not null references public.club_books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating numeric(2,1) not null check (rating >= 0 and rating <= 5),
  review text,
  recommend boolean,
  submitted_at timestamptz not null default now(),
  primary key (club_book_id, user_id)
);

alter table public.book_ratings enable row level security;

drop policy if exists "Members can view ratings" on public.book_ratings;
create policy "Members can view ratings"
on public.book_ratings for select to authenticated
using (
  exists (
    select 1 from public.club_books cb
    where cb.id = book_ratings.club_book_id
      and public.is_club_member(cb.club_id)
  )
);

drop policy if exists "Users can create their own rating" on public.book_ratings;
create policy "Users can create their own rating"
on public.book_ratings for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.club_books cb
    where cb.id = book_ratings.club_book_id
      and public.is_club_member(cb.club_id)
  )
);

drop policy if exists "Users can update their own rating" on public.book_ratings;
create policy "Users can update their own rating"
on public.book_ratings for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create table if not exists public.club_archives (
  id uuid primary key default gen_random_uuid(),
  club_book_id uuid unique not null references public.club_books(id) on delete cascade,
  issue_number integer,
  recap text,
  cover_image_url text,
  created_at timestamptz not null default now()
);

alter table public.club_archives enable row level security;

drop policy if exists "Members can view club archives" on public.club_archives;
create policy "Members can view club archives"
on public.club_archives for select to authenticated
using (
  exists (
    select 1 from public.club_books cb
    where cb.id = club_archives.club_book_id
      and public.is_club_member(cb.club_id)
  )
);

-- =========================================================
-- 6) PERSONAL LIBRARY / GOODREADS IMPORT
-- =========================================================

create table if not exists public.personal_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  shelf text not null default 'want_to_read',
  rating numeric(2,1) check (rating >= 0 and rating <= 5),
  date_started date,
  date_finished date,
  review text,
  source text not null default 'book_club',
  source_record_id text,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, book_id)
);

create table if not exists public.goodreads_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text,
  status text not null default 'processing',
  total_rows integer default 0,
  imported_rows integer default 0,
  skipped_rows integer default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.personal_books enable row level security;
alter table public.goodreads_imports enable row level security;

drop policy if exists "Users can view their personal books" on public.personal_books;
create policy "Users can view their personal books"
on public.personal_books for select to authenticated
using (user_id = auth.uid() or is_public = true);

drop policy if exists "Users can insert their personal books" on public.personal_books;
create policy "Users can insert their personal books"
on public.personal_books for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update their personal books" on public.personal_books;
create policy "Users can update their personal books"
on public.personal_books for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can delete their personal books" on public.personal_books;
create policy "Users can delete their personal books"
on public.personal_books for delete to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can view their Goodreads imports" on public.goodreads_imports;
create policy "Users can view their Goodreads imports"
on public.goodreads_imports for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can create Goodreads imports" on public.goodreads_imports;
create policy "Users can create Goodreads imports"
on public.goodreads_imports for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update Goodreads imports" on public.goodreads_imports;
create policy "Users can update Goodreads imports"
on public.goodreads_imports for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- =========================================================
-- 7) READER'S COMPANION CACHE
-- =========================================================

create table if not exists public.book_context_items (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  kind text not null,
  title text not null,
  summary_short text,
  summary_medium text,
  summary_deep text,
  spoiler_chapter integer,
  confidence numeric(4,3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.context_sources (
  id uuid primary key default gen_random_uuid(),
  context_item_id uuid not null references public.book_context_items(id) on delete cascade,
  source_url text not null,
  source_name text,
  source_type text,
  created_at timestamptz not null default now()
);

alter table public.book_context_items enable row level security;
alter table public.context_sources enable row level security;

-- Authenticated users may read cached public book research.
drop policy if exists "Authenticated users can read book context" on public.book_context_items;
create policy "Authenticated users can read book context"
on public.book_context_items for select to authenticated
using (true);

drop policy if exists "Authenticated users can read context sources" on public.context_sources;
create policy "Authenticated users can read context sources"
on public.context_sources for select to authenticated
using (true);

-- Inserts/updates should be done server-side with service credentials,
-- so no authenticated INSERT/UPDATE policy is added here.

-- =========================================================
-- 8) NOTIFICATIONS
-- =========================================================

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

alter table public.notifications enable row level security;
create index if not exists idx_notifications_user_created
on public.notifications(user_id, created_at desc);

drop policy if exists "Users can view their notifications" on public.notifications;
create policy "Users can view their notifications"
on public.notifications for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can mark their notifications read" on public.notifications;
create policy "Users can mark their notifications read"
on public.notifications for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- =========================================================
-- 9) STORAGE BUCKETS
-- =========================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('club-media', 'club-media', false)
on conflict (id) do nothing;

drop policy if exists "Users manage own avatar files" on storage.objects;
create policy "Users manage own avatar files"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Club members can read club media" on storage.objects;
create policy "Club members can read club media"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'club-media'
  and public.is_club_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Club members can upload club media" on storage.objects;
create policy "Club members can upload club media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'club-media'
  and public.is_club_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Users can delete own club media" on storage.objects;
create policy "Users can delete own club media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'club-media'
  and owner_id = auth.uid()::text
);

-- =========================================================
-- 10) REALTIME
-- =========================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'posts'
  ) then
    alter publication supabase_realtime add table public.posts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'replies'
  ) then
    alter publication supabase_realtime add table public.replies;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reactions'
  ) then
    alter publication supabase_realtime add table public.reactions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reading_progress'
  ) then
    alter publication supabase_realtime add table public.reading_progress;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'meeting_rsvps'
  ) then
    alter publication supabase_realtime add table public.meeting_rsvps;
  end if;
end $$;

commit;
