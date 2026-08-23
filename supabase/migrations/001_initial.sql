-- BOOK CLUB production schema — private, multi-club, RLS-first.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null default '',
  avatar_url text,
  signature_book_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  open_library_key text,
  google_books_id text,
  isbn13 text,
  title text not null,
  author text not null,
  cover_url text,
  description text,
  page_count integer,
  first_publish_year integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists books_isbn13_unique on public.books(isbn13) where isbn13 is not null;

alter table public.profiles drop constraint if exists profiles_signature_book_id_fkey;
alter table public.profiles add constraint profiles_signature_book_id_fkey foreign key(signature_book_id) references public.books(id) on delete set null;

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  invite_code text not null unique default encode(gen_random_bytes(6),'hex'),
  meeting_type text not null default 'facetime' check (meeting_type in ('facetime','in_person','either','other')),
  cadence text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.club_members (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check(role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key(club_id,user_id)
);

create table if not exists public.profile_shelves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  accent text not null default 'pink',
  created_at timestamptz not null default now()
);
create table if not exists public.profile_shelf_books (
  shelf_id uuid not null references public.profile_shelves(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  position integer not null default 0,
  added_at timestamptz not null default now(),
  primary key(shelf_id,book_id)
);

create table if not exists public.club_books (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete restrict,
  status text not null default 'idea' check(status in ('idea','nominated','ballot','up_next','reading','finished','dnf','archived')),
  started_at date,
  target_finish_at date,
  finished_at date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists club_books_club_status_idx on public.club_books(club_id,status);

create table if not exists public.reading_progress (
  club_book_id uuid not null references public.club_books(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  chapter integer,
  page integer,
  percent numeric(5,2),
  participation_status text not null default 'reading' check(participation_status in ('reading','catching_up','finished','sitting_out')),
  updated_at timestamptz not null default now(),
  primary key(club_book_id,user_id)
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  club_book_id uuid not null references public.club_books(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'thought' check(type in ('thought','quote','question','prediction')),
  body text not null,
  chapter integer,
  page integer,
  spoiler boolean not null default false,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists posts_club_book_created_idx on public.posts(club_book_id,created_at desc);

create table if not exists public.post_replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now(),
  primary key(post_id,user_id,reaction)
);

create table if not exists public.nominations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  nominated_by uuid not null references public.profiles(id) on delete cascade,
  why text,
  round_key text not null default to_char(now(),'YYYY-MM'),
  created_at timestamptz not null default now()
);
create table if not exists public.votes (
  nomination_id uuid not null references public.nominations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  points integer not null default 1 check(points between 1 and 3),
  created_at timestamptz not null default now(),
  primary key(nomination_id,user_id)
);

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  club_book_id uuid references public.club_books(id) on delete set null,
  starts_at timestamptz not null,
  meeting_type text not null default 'facetime',
  join_url text,
  status text not null default 'scheduled' check(status in ('proposed','scheduled','completed','cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.meeting_rsvps (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  response text not null check(response in ('yes','maybe','no')),
  primary key(meeting_id,user_id)
);

create table if not exists public.book_context_items (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  type text not null,
  title text not null,
  kicker text,
  summary_short text,
  summary_medium text,
  summary_deep text,
  spoiler_chapter integer not null default 0,
  confidence numeric(4,3),
  source_state text not null default 'curated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.context_sources (
  id uuid primary key default gen_random_uuid(),
  context_item_id uuid not null references public.book_context_items(id) on delete cascade,
  source_name text not null,
  source_url text not null,
  source_type text,
  created_at timestamptz not null default now()
);

-- Auth profile bootstrap.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,display_name,username)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), split_part(new.email,'@',1) || '_' || substr(new.id::text,1,6))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Helper functions used by RLS.
create or replace function public.is_club_member(cid uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.club_members cm where cm.club_id=cid and cm.user_id=auth.uid());
$$;
create or replace function public.is_club_admin(cid uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.club_members cm where cm.club_id=cid and cm.user_id=auth.uid() and cm.role in ('owner','admin'));
$$;

alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.profile_shelves enable row level security;
alter table public.profile_shelf_books enable row level security;
alter table public.club_books enable row level security;
alter table public.reading_progress enable row level security;
alter table public.posts enable row level security;
alter table public.post_replies enable row level security;
alter table public.post_reactions enable row level security;
alter table public.nominations enable row level security;
alter table public.votes enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_rsvps enable row level security;
alter table public.book_context_items enable row level security;
alter table public.context_sources enable row level security;

-- Public book catalog; private social data.
create policy "books readable authenticated" on public.books for select to authenticated using(true);
create policy "profiles self or shared club" on public.profiles for select to authenticated using (
  id=auth.uid() or exists(select 1 from public.club_members me join public.club_members them on them.club_id=me.club_id where me.user_id=auth.uid() and them.user_id=profiles.id)
);
create policy "profiles self update" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy "clubs members only" on public.clubs for select to authenticated using(public.is_club_member(id));
create policy "clubs owner create" on public.clubs for insert to authenticated with check(owner_id=auth.uid());
create policy "clubs admins update" on public.clubs for update to authenticated using(public.is_club_admin(id));
create policy "club members visible to members" on public.club_members for select to authenticated using(public.is_club_member(club_id));
create policy "club members self join or admin add" on public.club_members for insert to authenticated with check(user_id=auth.uid() or public.is_club_admin(club_id));
create policy "shelves own write" on public.profile_shelves for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "shelves shared-club read" on public.profile_shelves for select to authenticated using(user_id=auth.uid() or exists(select 1 from public.club_members a join public.club_members b on a.club_id=b.club_id where a.user_id=auth.uid() and b.user_id=profile_shelves.user_id));
create policy "shelf books through owned shelf" on public.profile_shelf_books for all to authenticated using(exists(select 1 from public.profile_shelves s where s.id=shelf_id and s.user_id=auth.uid())) with check(exists(select 1 from public.profile_shelves s where s.id=shelf_id and s.user_id=auth.uid()));
create policy "club books members" on public.club_books for select to authenticated using(public.is_club_member(club_id));
create policy "club books admins write" on public.club_books for all to authenticated using(public.is_club_admin(club_id)) with check(public.is_club_admin(club_id));
create policy "progress members read" on public.reading_progress for select to authenticated using(exists(select 1 from public.club_books cb where cb.id=club_book_id and public.is_club_member(cb.club_id)));
create policy "progress own write" on public.reading_progress for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "posts members read" on public.posts for select to authenticated using(exists(select 1 from public.club_books cb where cb.id=club_book_id and public.is_club_member(cb.club_id)));
create policy "posts own create" on public.posts for insert to authenticated with check(user_id=auth.uid() and exists(select 1 from public.club_books cb where cb.id=club_book_id and public.is_club_member(cb.club_id)));
create policy "posts own update" on public.posts for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "posts own delete" on public.posts for delete to authenticated using(user_id=auth.uid());
create policy "replies member read" on public.post_replies for select to authenticated using(exists(select 1 from public.posts p join public.club_books cb on cb.id=p.club_book_id where p.id=post_id and public.is_club_member(cb.club_id)));
create policy "replies own write" on public.post_replies for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "reactions member read" on public.post_reactions for select to authenticated using(exists(select 1 from public.posts p join public.club_books cb on cb.id=p.club_book_id where p.id=post_id and public.is_club_member(cb.club_id)));
create policy "reactions own write" on public.post_reactions for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "nominations club member" on public.nominations for all to authenticated using(public.is_club_member(club_id)) with check(public.is_club_member(club_id) and nominated_by=auth.uid());
create policy "votes member" on public.votes for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and exists(select 1 from public.nominations n where n.id=nomination_id and public.is_club_member(n.club_id)));
create policy "meetings member read" on public.meetings for select to authenticated using(public.is_club_member(club_id));
create policy "meetings admin write" on public.meetings for all to authenticated using(public.is_club_admin(club_id)) with check(public.is_club_admin(club_id));
create policy "rsvps own write" on public.meeting_rsvps for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "context authenticated read" on public.book_context_items for select to authenticated using(true);
create policy "context sources authenticated read" on public.context_sources for select to authenticated using(true);
