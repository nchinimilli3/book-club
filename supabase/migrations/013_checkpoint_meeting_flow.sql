-- Meetings are checkpoint-specific. This removes date-proximity guessing from the
-- client and makes one confirmed meeting the sole source for RSVP surfaces.
alter table public.meetings add column if not exists checkpoint_id uuid references public.reading_checkpoints(id) on delete set null;
alter table public.meeting_options add column if not exists checkpoint_id uuid references public.reading_checkpoints(id) on delete cascade;
create index if not exists meetings_checkpoint_idx on public.meetings(checkpoint_id);
create index if not exists meeting_options_checkpoint_idx on public.meeting_options(checkpoint_id,starts_at);

drop function if exists public.save_meeting_options(uuid,uuid,timestamptz[]);
create or replace function public.save_meeting_options(target_club_id uuid,target_club_book_id uuid,target_checkpoint_id uuid,target_options timestamptz[])
returns void language plpgsql security definer set search_path=public as $$
declare option_count integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not (exists(select 1 from public.clubs where id=target_club_id and owner_id=auth.uid()) or exists(select 1 from public.club_members where club_id=target_club_id and user_id=auth.uid() and role in ('owner','admin'))) then raise exception 'Only a club owner or admin can propose meeting times'; end if;
  if target_checkpoint_id is null then raise exception 'Choose a reading checkpoint'; end if;
  if not exists(select 1 from public.reading_checkpoints where id=target_checkpoint_id and club_book_id=target_club_book_id) then raise exception 'Checkpoint does not belong to this book'; end if;
  option_count:=coalesce(array_length(target_options,1),0);
  if option_count<2 or option_count>5 then raise exception 'Choose between two and five meeting times'; end if;
  if exists(select 1 from unnest(target_options) x where x<=now()+interval '15 minutes') then raise exception 'Meeting options must be in the future'; end if;
  delete from public.meeting_options where checkpoint_id=target_checkpoint_id;
  insert into public.meeting_options(club_id,club_book_id,checkpoint_id,starts_at,created_by)
  select target_club_id,target_club_book_id,target_checkpoint_id,x,auth.uid() from (select distinct unnest(target_options) x) q order by x;
end;
$$;
revoke all on function public.save_meeting_options(uuid,uuid,uuid,timestamptz[]) from public;
grant execute on function public.save_meeting_options(uuid,uuid,uuid,timestamptz[]) to authenticated;

drop function if exists public.save_club_meeting(uuid,uuid,uuid,timestamptz,text,text);
create or replace function public.save_club_meeting(target_club_id uuid,target_club_book_id uuid,target_meeting_id uuid,target_starts_at timestamptz,target_meeting_type text default 'facetime',target_meeting_url text default null,target_checkpoint_id uuid default null)
returns public.meetings language plpgsql security definer set search_path=public as $$
declare result_row public.meetings;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not (exists(select 1 from public.clubs where id=target_club_id and owner_id=auth.uid()) or exists(select 1 from public.club_members where club_id=target_club_id and user_id=auth.uid() and role in ('owner','admin'))) then raise exception 'Only a club owner or admin can confirm meetings'; end if;
  if target_checkpoint_id is null or not exists(select 1 from public.reading_checkpoints where id=target_checkpoint_id and club_book_id=target_club_book_id) then raise exception 'Choose a checkpoint for this meeting'; end if;
  if target_starts_at<=now()-interval '5 minutes' then raise exception 'Meeting time must be in the future'; end if;
  if target_meeting_id is not null then
    update public.meetings set checkpoint_id=target_checkpoint_id,starts_at=target_starts_at,meeting_type=target_meeting_type,meeting_url=nullif(target_meeting_url,''),status='scheduled',updated_at=now() where id=target_meeting_id and club_id=target_club_id returning * into result_row;
  else
    insert into public.meetings(club_id,club_book_id,checkpoint_id,starts_at,meeting_type,meeting_url,status,created_by,updated_at) values(target_club_id,target_club_book_id,target_checkpoint_id,target_starts_at,target_meeting_type,nullif(target_meeting_url,''),'scheduled',auth.uid(),now()) returning * into result_row;
  end if;
  if result_row.id is null then raise exception 'Meeting not found'; end if;
  delete from public.meeting_options where checkpoint_id=target_checkpoint_id;
  return result_row;
end;
$$;
revoke all on function public.save_club_meeting(uuid,uuid,uuid,timestamptz,text,text,uuid) from public;
grant execute on function public.save_club_meeting(uuid,uuid,uuid,timestamptz,text,text,uuid) to authenticated;
