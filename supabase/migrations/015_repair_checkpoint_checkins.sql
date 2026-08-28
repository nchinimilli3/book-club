-- Repair migration for meeting-room checkpoint check-ins.
-- Safe to run after any prior migration state.

create table if not exists public.checkpoint_checkins (
  checkpoint_id uuid not null references public.reading_checkpoints(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('reached','catching_up','not_yet')),
  updated_at timestamptz not null default now(),
  primary key (checkpoint_id,user_id)
);

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
as $function$
declare
  uid uuid:=auth.uid();
  club_id uuid;
  saved public.checkpoint_checkins;
begin
  if uid is null then raise exception 'You must be signed in'; end if;
  if target_status not in ('reached','catching_up','not_yet') then raise exception 'Invalid checkpoint status'; end if;

  select cb.club_id into club_id
  from public.reading_checkpoints rc
  join public.club_books cb on cb.id=rc.club_book_id
  where rc.id=target_checkpoint_id;

  if club_id is null then raise exception 'Checkpoint not found'; end if;
  if not public.is_club_member(club_id) then raise exception 'Not a club member'; end if;

  insert into public.checkpoint_checkins(checkpoint_id,user_id,status,updated_at)
  values(target_checkpoint_id,uid,target_status,now())
  on conflict(checkpoint_id,user_id)
  do update set status=excluded.status,updated_at=now()
  returning * into saved;

  return saved;
end;
$function$;

revoke all on function public.set_checkpoint_checkin(uuid,text) from public,anon;
grant execute on function public.set_checkpoint_checkin(uuid,text) to authenticated;
