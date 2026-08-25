# Progress scene distribution

Run `supabase/migrations/011_progress_scene_distribution.sql` in Supabase after the existing migrations.

It adds a persistent `clubs.progress_scene` value (`race` or `sailing`), evenly backfills existing clubs so a small set does not accidentally all receive the same scene, and assigns future clubs a scene once at creation time. The UI also has a development-only balancing fallback so localhost shows both scene types even before the migration is run.
