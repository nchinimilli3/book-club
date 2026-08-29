-- Repair migration 017 deployments where the canonical vote-start RPC was
-- created successfully but its authenticated execute grant was omitted.
-- Migration 020 creates the function when it is absent, so this remains a
-- safe no-op during ordered migration runs.
do $$
begin
  if to_regprocedure('public.start_ballot_from_ideas(uuid,timestamptz)') is not null then
    execute 'revoke all on function public.start_ballot_from_ideas(uuid,timestamptz) from public,anon';
    execute 'grant execute on function public.start_ballot_from_ideas(uuid,timestamptz) to authenticated';
  end if;
end
$$;
