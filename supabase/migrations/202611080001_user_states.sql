-- User-owned application documents preserve the existing prototype data model.
-- Shared groups will need separate membership and entry tables.
begin;
create table public.user_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint valid_state check (
    coalesce(jsonb_typeof(state) = 'object'
    and state ->> 'v' = '1'
    and jsonb_typeof(state -> 'profile') = 'object'
    and jsonb_typeof(state -> 'entries') = 'array'
    and jsonb_typeof(state -> 'categories') = 'array'
    and jsonb_typeof(state -> 'groups') = 'array'
    and octet_length(state::text) <= 3000000, false)
  )
);
alter table public.user_states enable row level security;
revoke all on public.user_states from anon, authenticated;
grant select on public.user_states to authenticated;
create policy "Read own state" on public.user_states for select to authenticated
  using ((select auth.uid()) = user_id);

-- Atomic expected-revision writes prevent one device from overwriting another.
create function public.save_user_state(p_state jsonb, p_revision integer)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  next_revision integer;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_revision is null or p_revision < 0 then raise exception 'INVALID_REVISION'; end if;
  if p_revision = 0 then
    insert into public.user_states(user_id, state) values (caller, p_state)
      on conflict (user_id) do nothing returning revision into next_revision;
  else
    update public.user_states set state = p_state, revision = revision + 1, updated_at = now()
      where user_id = caller and revision = p_revision returning revision into next_revision;
  end if;
  if next_revision is null then raise exception 'STATE_CONFLICT'; end if;
  return next_revision;
end;
$$;
revoke all on function public.save_user_state(jsonb, integer) from public, anon;
grant execute on function public.save_user_state(jsonb, integer) to authenticated;
commit;
