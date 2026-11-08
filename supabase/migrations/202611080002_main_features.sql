-- Add main's shared groups, notifications and AI history without replacing existing diaries.
begin;

-- Protect shared-member rendering even if an authenticated client calls RPC directly.
create function public.app_valid_personal(p_state jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare p jsonb := p_state -> 'profile'; e jsonb; category jsonb;
begin
  if not coalesce(
    jsonb_typeof(p) = 'object' and jsonb_typeof(p -> 'name') = 'string' and length(btrim(p ->> 'name')) between 1 and 20
    and jsonb_typeof(p -> 'bio') = 'string' and length(p ->> 'bio') <= 40
    and jsonb_typeof(p -> 'photo') = 'string' and length(p ->> 'photo') <= 500000
    and jsonb_typeof(p -> 'public') = 'boolean' and jsonb_typeof(p -> 'notify') = 'boolean'
    and jsonb_typeof(p -> 'periodDays') = 'number' and p ->> 'periodDays' in ('7', '14', '30')
    and p ->> 'theme' in ('system', 'light', 'dark') and p ->> 'fontScale' in ('90', '100', '110', '120', '130')
    and p ->> 'startDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and jsonb_typeof(p_state -> 'categories') = 'array' and jsonb_typeof(p_state -> 'entries') = 'array', false) then return false; end if;
  perform (p ->> 'startDate')::date;
  if p ->> 'photo' <> '' and p ->> 'photo' !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then return false; end if;
  if jsonb_array_length(p_state -> 'categories') not between 1 and 100 or jsonb_array_length(p_state -> 'entries') > 10000 then return false; end if;
  for category in select value from jsonb_array_elements(p_state -> 'categories') loop
    if jsonb_typeof(category) <> 'string' or length(btrim(category #>> '{}')) not between 1 and 15 then return false; end if;
  end loop;
  for e in select value from jsonb_array_elements(p_state -> 'entries') loop
    if not coalesce(jsonb_typeof(e) = 'object' and e ->> 'id' ~ '^[a-zA-Z0-9_-]{1,80}$'
      and e ->> 'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and p_state -> 'categories' ? (e ->> 'category')
      and jsonb_typeof(e -> 'title') = 'string' and length(btrim(e ->> 'title')) between 1 and 200
      and jsonb_typeof(e -> 'summary') = 'string' and length(btrim(e ->> 'summary')) between 1 and 20000
      and jsonb_typeof(e -> 'raw') = 'string' and length(e ->> 'raw') <= 50000
      and jsonb_typeof(e -> 'tags') = 'array' and jsonb_typeof(e -> 'qa') = 'array', false) then return false; end if;
    perform (e ->> 'date')::date;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.app_valid_personal(jsonb) from public, anon, authenticated;
alter table public.user_states add constraint valid_personal check (public.app_valid_personal(state)) not valid;

create table public.app_groups (
  id uuid primary key default gen_random_uuid(), name text not null check (length(btrim(name)) between 1 and 20),
  code text not null unique, owner_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.app_memberships (
  group_id uuid not null references public.app_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index app_memberships_user on public.app_memberships(user_id);
create table public.app_pokes (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.app_groups(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  period integer not null, date date not null, created_at timestamptz not null default now(), read_at timestamptz,
  unique (group_id, sender_id, recipient_id, period)
);
create index app_pokes_recipient on public.app_pokes(recipient_id, created_at);
create table public.app_ai_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  task text not null, input jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
create index app_ai_runs_user on public.app_ai_runs(user_id, created_at desc);

alter table public.app_groups enable row level security;
alter table public.app_memberships enable row level security;
alter table public.app_pokes enable row level security;
alter table public.app_ai_runs enable row level security;
revoke all on public.app_groups, public.app_memberships, public.app_pokes, public.app_ai_runs from anon, authenticated;

-- Only the same public member fields that main exposes are returned, even through direct RPC calls.
create function public.app_member_summary(p_user uuid, p_state jsonb, p_today date)
returns jsonb language plpgsql set search_path = '' as $$
declare
  profile jsonb := p_state -> 'profile';
  days integer := (profile ->> 'periodDays')::integer;
  start_day date := (profile ->> 'startDate')::date;
  current_period integer;
  completed integer[];
  done_now boolean;
  streak integer := 0;
  cursor_period integer;
begin
  current_period := floor((p_today - start_day)::numeric / days)::integer;
  select coalesce(array_agg(distinct floor(((e ->> 'date')::date - start_day)::numeric / days)::integer), '{}') into completed
    from jsonb_array_elements(p_state -> 'entries') e;
  done_now := current_period >= 0 and current_period = any(completed);
  cursor_period := case when done_now then current_period else current_period - 1 end;
  while cursor_period >= 0 and cursor_period = any(completed) loop
    streak := streak + 1; cursor_period := cursor_period - 1;
  end loop;
  return jsonb_build_object('id', p_user, 'name', profile ->> 'name', 'photo', profile ->> 'photo',
    'color', '#7c3aed', 'public', profile -> 'public', 'periodDays', days, 'startDate', start_day,
    'doneNow', done_now, 'streak', streak,
    'entries', case when profile ->> 'public' = 'true' then p_state -> 'entries' else '[]'::jsonb end);
end;
$$;
revoke all on function public.app_member_summary(uuid, jsonb, date) from public, anon, authenticated;

create function public.app_state(p_default jsonb, p_today date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  mine public.user_states%rowtype;
  groups jsonb;
  pokes jsonb;
  notifications jsonb;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  insert into public.user_states(user_id, state) values (caller, p_default) on conflict (user_id) do nothing;
  select * into mine from public.user_states where user_id = caller;
  select coalesce(jsonb_agg(g.info order by g.created_at, g.id), '[]') into groups from (
    select gr.id, gr.created_at, jsonb_build_object('id', gr.id, 'name', gr.name, 'code', gr.code, 'ownerId', gr.owner_id,
      'members', (select coalesce(jsonb_agg(public.app_member_summary(m.user_id, s.state, p_today) order by m.joined_at, m.user_id), '[]')
        from public.app_memberships m join public.user_states s on s.user_id = m.user_id
        where m.group_id = gr.id and m.user_id <> caller)) as info
    from public.app_groups gr join public.app_memberships own on own.group_id = gr.id and own.user_id = caller
  ) g;
  select coalesce(jsonb_object_agg(p.group_id::text || ':' || p.recipient_id::text || ':' || p.period, p.date::text), '{}') into pokes
    from public.app_pokes p where p.sender_id = caller;
  select coalesce(jsonb_agg(n.info order by n.created_at desc), '[]') into notifications from (
    select p.created_at, jsonb_build_object('id', p.id, 'groupId', p.group_id, 'groupName', g.name,
      'createdAt', floor(extract(epoch from p.created_at) * 1000)::bigint, 'senderName', s.state -> 'profile' ->> 'name') as info
    from public.app_pokes p join public.app_groups g on g.id = p.group_id
    join public.user_states s on s.user_id = p.sender_id
    join public.app_memberships m on m.group_id = p.group_id and m.user_id = caller
    where p.recipient_id = caller and p.read_at is null order by p.created_at desc limit 50
  ) n;
  return jsonb_build_object('revision', mine.revision, 'state', mine.state || jsonb_build_object(
    'groups', groups, 'pokes', pokes, 'notifications', notifications));
end;
$$;

create function public.app_group_action(p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  group_row public.app_groups%rowtype;
  group_id uuid;
  recipient uuid;
  next_owner uuid;
  recipient_state jsonb;
  today date;
  start_day date;
  days integer;
  period integer;
  label text;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Serialize this user's group-limit checks and lock group rows before member changes.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  if p_action = 'read' then
    update public.app_pokes set read_at = now() where recipient_id = caller and read_at is null;
    return jsonb_build_object('ok', true);
  elsif p_action = 'create' then
    label := btrim(p_payload ->> 'name');
    if label is null or length(label) not between 1 and 20 then raise exception 'INVALID_INPUT'; end if;
    if (select count(*) from public.app_memberships where user_id = caller) >= 100 then raise exception 'GROUP_LIMIT'; end if;
    insert into public.app_groups(name, code, owner_id) values (label, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)), caller)
      returning id into group_id;
    insert into public.app_memberships(group_id, user_id) values (group_id, caller);
    return jsonb_build_object('id', group_id);
  elsif p_action = 'join' then
    select * into group_row from public.app_groups where code = upper(btrim(p_payload ->> 'code')) for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if exists(select 1 from public.app_memberships m where m.group_id = group_row.id and m.user_id = caller) then
      return jsonb_build_object('id', group_row.id);
    end if;
    if (select count(*) from public.app_memberships where user_id = caller) >= 100 or
      (select count(*) from public.app_memberships m where m.group_id = group_row.id) >= 100 then raise exception 'GROUP_LIMIT'; end if;
    insert into public.app_memberships(group_id, user_id) values (group_row.id, caller);
    return jsonb_build_object('id', group_row.id);
  elsif p_action not in ('leave', 'poke') then raise exception 'INVALID_INPUT';
  end if;
  select * into group_row from public.app_groups where id = (p_payload ->> 'groupId')::uuid for update;
  if not found or not exists(select 1 from public.app_memberships m where m.group_id = group_row.id and m.user_id = caller) then
    raise exception 'NOT_MEMBER';
  end if;
  if p_action = 'leave' then
    delete from public.app_memberships m where m.group_id = group_row.id and m.user_id = caller;
    delete from public.app_pokes p where p.group_id = group_row.id and (p.sender_id = caller or p.recipient_id = caller);
    select m.user_id into next_owner from public.app_memberships m where m.group_id = group_row.id order by m.joined_at, m.user_id limit 1;
    if next_owner is null then delete from public.app_groups where id = group_row.id;
    elsif group_row.owner_id = caller then update public.app_groups set owner_id = next_owner where id = group_row.id;
    end if;
    return jsonb_build_object('ok', true);
  end if;
  recipient := (p_payload ->> 'recipientId')::uuid;
  if not exists(select 1 from public.app_memberships m where m.group_id = group_row.id and m.user_id = recipient) then raise exception 'NOT_MEMBER'; end if;
  if recipient = caller then raise exception 'INVALID_INPUT'; end if;
  select state into recipient_state from public.user_states where user_id = recipient;
  -- Do not trust a browser-provided date to bypass per-period poke deduplication.
  today := (now() at time zone 'UTC')::date;
  start_day := (recipient_state -> 'profile' ->> 'startDate')::date;
  days := (recipient_state -> 'profile' ->> 'periodDays')::integer;
  period := floor((today - start_day)::numeric / days)::integer;
  if period is null or period < 0 or exists(select 1 from jsonb_array_elements(recipient_state -> 'entries') e
    where floor(((e ->> 'date')::date - start_day)::numeric / days)::integer = period) then raise exception 'POKE_UNAVAILABLE'; end if;
  insert into public.app_pokes(group_id, sender_id, recipient_id, period, date)
    values (group_row.id, caller, recipient, period, today) on conflict do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.app_ai_history(p_run jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); history jsonb;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_run is not null then
    if coalesce(p_run ->> 'task', '') not in ('followup', 'summarize', 'questions', 'evaluate', 'match', 'insight')
      or p_run -> 'input' is null or p_run -> 'result' is null or octet_length(p_run::text) > 1000000 then raise exception 'INVALID_INPUT'; end if;
    insert into public.app_ai_runs(user_id, task, input, result) values (caller, p_run ->> 'task', p_run -> 'input', p_run -> 'result');
  end if;
  select coalesce(jsonb_agg(r.info order by r.created_at desc, r.id desc), '[]') into history from (
    select id, created_at, jsonb_build_object('id', id, 'task', task, 'input', input, 'result', result,
      'createdAt', floor(extract(epoch from created_at) * 1000)::bigint) as info
    from public.app_ai_runs where user_id = caller order by created_at desc, id desc limit 30
  ) r;
  return history;
end;
$$;

revoke all on function public.app_state(jsonb, date), public.app_group_action(text, jsonb), public.app_ai_history(jsonb) from public, anon;
grant execute on function public.app_state(jsonb, date), public.app_group_action(text, jsonb), public.app_ai_history(jsonb) to authenticated;
commit;
