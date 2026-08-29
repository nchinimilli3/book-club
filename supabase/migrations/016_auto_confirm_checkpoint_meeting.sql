-- Confirm checkpoint meeting times once every club member submits availability.
-- Idempotent so it can be safely pasted into Supabase SQL Editor.
create table if not exists public.meeting_poll_submissions(
  checkpoint_id uuid not null references public.reading_checkpoints(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  primary key(checkpoint_id,user_id)
);

alter table public.meeting_poll_submissions enable row level security;

drop policy if exists "club members read meeting poll submissions"
on public.meeting_poll_submissions;

create policy "club members read meeting poll submissions"
on public.meeting_poll_submissions
for select to authenticated
using (
  exists (
    select 1
    from public.reading_checkpoints rc
    join public.club_books cb on cb.id = rc.club_book_id
    where rc.id = meeting_poll_submissions.checkpoint_id
      and public.is_club_member(cb.club_id)
  )
);

create or replace function public.submit_meeting_poll(target_checkpoint_id uuid)
returns public.meetings
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
  cbid uuid;
  member_count integer;
  submission_count integer;
  winner timestamptz;
  result_row public.meetings;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select cb.club_id, rc.club_book_id into cid, cbid
  from public.reading_checkpoints rc
  join public.club_books cb on cb.id = rc.club_book_id
  where rc.id = target_checkpoint_id;

  if cid is null or not public.is_club_member(cid) then
    raise exception 'Not a club member';
  end if;

  if not exists (select 1 from public.meeting_options where checkpoint_id = target_checkpoint_id) then
    raise exception 'This poll has no options';
  end if;

  insert into public.meeting_poll_submissions(checkpoint_id,user_id,submitted_at)
  values(target_checkpoint_id,auth.uid(),now())
  on conflict (checkpoint_id,user_id) do update set submitted_at = now();

  select count(*) into member_count from public.club_members where club_id = cid;
  select count(*) into submission_count
  from public.meeting_poll_submissions where checkpoint_id = target_checkpoint_id;

  if submission_count < member_count then return null; end if;

  select mo.starts_at into winner
  from public.meeting_options mo
  left join public.meeting_option_responses mor
    on mor.option_id = mo.id and mor.available = true
  where mo.checkpoint_id = target_checkpoint_id
  group by mo.id, mo.starts_at
  order by count(mor.user_id) desc, mo.starts_at asc
  limit 1;

  if winner is null then raise exception 'No meeting option is available'; end if;

  update public.meetings
  set status = 'cancelled', updated_at = now()
  where checkpoint_id = target_checkpoint_id and status = 'scheduled';

  insert into public.meetings(
    club_id,club_book_id,checkpoint_id,starts_at,meeting_type,status,created_by,updated_at
  )
  values(cid,cbid,target_checkpoint_id,winner,'facetime','scheduled',auth.uid(),now())
  returning * into result_row;

  delete from public.meeting_options where checkpoint_id = target_checkpoint_id;
  delete from public.meeting_poll_submissions where checkpoint_id = target_checkpoint_id;
  return result_row;
end;
$$;

revoke all on function public.submit_meeting_poll(uuid) from public, anon;
grant execute on function public.submit_meeting_poll(uuid) to authenticated;
