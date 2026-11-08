begin;

-- Adapt the notification worktree cooldown without changing poke IDs referenced by the existing outbox.

create or replace function public.app_state(p_default jsonb, p_today date)
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
  select coalesce(jsonb_object_agg(p.group_id::text || ':' || p.recipient_id::text, p.sent_at), '{}') into pokes
    from (select group_id, recipient_id, floor(extract(epoch from max(created_at)) * 1000)::bigint as sent_at
      from public.app_pokes where sender_id = caller group by group_id, recipient_id) p;
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

create or replace function public.app_group_action(p_action text, p_payload jsonb)
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
  -- Use server time for eligibility and the five-minute cooldown.
  today := (now() at time zone 'UTC')::date;
  start_day := (recipient_state -> 'profile' ->> 'startDate')::date;
  days := (recipient_state -> 'profile' ->> 'periodDays')::integer;
  period := floor((today - start_day)::numeric / days)::integer;
  if period is null or period < 0 or exists(select 1 from jsonb_array_elements(recipient_state -> 'entries') e
    where floor(((e ->> 'date')::date - start_day)::numeric / days)::integer = period) then raise exception 'POKE_UNAVAILABLE'; end if;
  if exists(select 1 from public.app_pokes p where p.group_id = group_row.id
    and p.sender_id = caller and p.recipient_id = recipient and p.created_at > now() - interval '5 minutes') then
    return jsonb_build_object('ok', true);
  end if;
  insert into public.app_pokes(group_id, sender_id, recipient_id, period, date)
    values (group_row.id, caller, recipient, period, today)
    on conflict on constraint app_pokes_group_id_sender_id_recipient_id_period_key do update
      set date = excluded.date, created_at = now(), read_at = null;
  return jsonb_build_object('ok', true);
end;
$$;

commit;
