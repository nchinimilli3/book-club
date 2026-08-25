-- Stable per-club progress-scene identity.
-- Existing clubs are backfilled in an even Race/Sailing split; future clubs get one
-- random scene once at creation time and keep it permanently unless explicitly changed.

alter table public.clubs
  add column if not exists progress_scene text;

-- Backfill NULL/invalid values with a deterministic alternating assignment so an
-- existing small set of clubs does not accidentally all receive the same scene.
with ranked as (
  select id,
         row_number() over (order by md5(id::text), id::text) as rn
  from public.clubs
  where progress_scene is null
     or progress_scene not in ('race','sailing')
)
update public.clubs c
set progress_scene = case when ranked.rn % 2 = 1 then 'race' else 'sailing' end
from ranked
where c.id = ranked.id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clubs_progress_scene_check'
      and conrelid = 'public.clubs'::regclass
  ) then
    alter table public.clubs
      add constraint clubs_progress_scene_check
      check (progress_scene in ('race','sailing'));
  end if;
end $$;

create or replace function public.assign_club_progress_scene()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.progress_scene is null or new.progress_scene not in ('race','sailing') then
    new.progress_scene := case when random() < 0.5 then 'race' else 'sailing' end;
  end if;
  return new;
end;
$$;

drop trigger if exists clubs_assign_progress_scene on public.clubs;
create trigger clubs_assign_progress_scene
before insert on public.clubs
for each row
execute function public.assign_club_progress_scene();

alter table public.clubs
  alter column progress_scene set not null;
