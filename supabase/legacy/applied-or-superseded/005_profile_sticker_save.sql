-- BOOK CLUB migration 005
-- Stable persistence contract for profile scrapbook/sticker layout.
-- Safe to run more than once.

alter table public.profiles
  add column if not exists profile_style jsonb not null
  default '{"palette":"rose","layout":"scrapbook","note":"","stickers":[]}'::jsonb;

grant select, update on public.profiles to authenticated;

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create or replace function public.save_my_profile_style(style_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.profiles
  set profile_style = coalesce(style_payload, '{}'::jsonb),
      updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found';
  end if;

  return style_payload;
end;
$$;

revoke all on function public.save_my_profile_style(jsonb) from public;
grant execute on function public.save_my_profile_style(jsonb) to authenticated;
