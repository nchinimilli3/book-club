-- BOOK CLUB migration 006
-- Verified, self-scoped profile style persistence.
-- Safe to run more than once and safe after migration 005.

begin;

grant usage on schema public to authenticated;

alter table public.profiles
  add column if not exists profile_style jsonb not null
  default '{"palette":"rose","layout":"scrapbook","note":"","stickers":[]}'::jsonb;

grant select, update on public.profiles to authenticated;

-- Keep direct self-update valid as a fallback.
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- V2 is deliberately SECURITY DEFINER, but it can only ever write auth.uid().
-- It also repairs a missing profile row, which can exist for accounts created before
-- the auth trigger was installed.
create or replace function public.save_my_profile_style_v2(style_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  persisted jsonb;
  fallback_name text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if jsonb_typeof(coalesce(style_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Profile style must be a JSON object';
  end if;

  update public.profiles
  set profile_style = coalesce(style_payload, '{}'::jsonb),
      updated_at = now()
  where id = uid
  returning profile_style into persisted;

  if persisted is null then
    fallback_name := coalesce(
      nullif(auth.jwt()->'user_metadata'->>'display_name', ''),
      nullif(auth.jwt()->'user_metadata'->>'full_name', ''),
      split_part(coalesce(auth.jwt()->>'email', 'Reader'), '@', 1),
      'Reader'
    );

    insert into public.profiles(id, display_name, profile_style)
    values(uid, fallback_name, coalesce(style_payload, '{}'::jsonb))
    on conflict (id) do update
      set profile_style = excluded.profile_style,
          updated_at = now()
    returning profile_style into persisted;
  end if;

  return persisted;
end;
$$;

revoke all on function public.save_my_profile_style_v2(jsonb) from public;
grant execute on function public.save_my_profile_style_v2(jsonb) to authenticated;

commit;

-- Make the new RPC visible to PostgREST immediately in Supabase.
notify pgrst, 'reload schema';
