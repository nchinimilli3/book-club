-- Feedback pass: ensure archive undo exists even when production was created before 009.
create or replace function public.restore_archived_book(target_club_book_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target_club_id uuid;
begin
  select club_id into target_club_id from public.club_books where id = target_club_book_id;
  if target_club_id is null then raise exception 'Book not found'; end if;
  if not public.is_club_admin(target_club_id) then raise exception 'Not allowed'; end if;
  update public.club_books set status = 'rating' where id = target_club_book_id;
  update public.clubs set status = 'rating', updated_at = now() where id = target_club_id;
end;
$$;
grant execute on function public.restore_archived_book(uuid) to authenticated;
