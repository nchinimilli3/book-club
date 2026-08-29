begin;

insert into storage.buckets (id, name, public)
values ('club-media', 'club-media', false)
on conflict (id) do update set public = false;

drop policy if exists "Club members can read club header media" on storage.objects;
create policy "Club members can read club header media"
on storage.objects for select to authenticated
using (
  bucket_id = 'club-media'
  and storage.filename(name) = 'header.jpg'
  and public.is_club_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Club members can insert club header media" on storage.objects;
create policy "Club members can insert club header media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'club-media'
  and storage.filename(name) = 'header.jpg'
  and public.is_club_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Club members can update club header media" on storage.objects;
create policy "Club members can update club header media"
on storage.objects for update to authenticated
using (
  bucket_id = 'club-media'
  and storage.filename(name) = 'header.jpg'
  and public.is_club_member(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'club-media'
  and storage.filename(name) = 'header.jpg'
  and public.is_club_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Club members can delete club header media" on storage.objects;
create policy "Club members can delete club header media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'club-media'
  and storage.filename(name) = 'header.jpg'
  and public.is_club_member(((storage.foldername(name))[1])::uuid)
);

drop function if exists public.update_club_header(uuid, text);

create function public.update_club_header(
  target_club_id uuid,
  target_cover_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_club_member(target_club_id) then
    raise exception 'You must be a member of this club';
  end if;
  if target_cover_path is not null and target_cover_path <> (target_club_id::text || '/header.jpg') then
    raise exception 'Invalid club header path';
  end if;
  update public.clubs
  set cover_image_url = target_cover_path,
      updated_at = now()
  where id = target_club_id;
end;
$$;

revoke all on function public.update_club_header(uuid, text) from public, anon;
grant execute on function public.update_club_header(uuid, text) to authenticated;

commit;
