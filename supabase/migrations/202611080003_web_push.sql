begin;
create table public.app_push_subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique, keys jsonb not null, pokes boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (length(endpoint) <= 2000 and endpoint ~ '^https://([a-zA-Z0-9-]+\.)*(push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com|fcm\.googleapis\.com)/'),
  check (coalesce(keys ->> 'p256dh' ~ '^[A-Za-z0-9_-]{87}={0,2}$' and keys ->> 'auth' ~ '^[A-Za-z0-9_-]{22}={0,2}$', false))
);
create index app_push_subscriptions_user on public.app_push_subscriptions(user_id);
create table public.app_push_outbox (
  id uuid primary key default gen_random_uuid(), subscription_id uuid not null references public.app_push_subscriptions(id) on delete cascade,
  event_key text not null, kind text not null check (kind in ('reminder', 'poke')),
  poke_id uuid references public.app_pokes(id) on delete cascade, actor_id uuid references auth.users(id) on delete cascade,
  payload jsonb not null, attempts integer not null default 0,
  available_at timestamptz not null default now(), lease_until timestamptz, lease_token uuid,
  sent_at timestamptz, created_at timestamptz not null default now(), unique(subscription_id, event_key)
);
create index app_push_outbox_pending on public.app_push_outbox(available_at) where sent_at is null;
alter table public.app_push_subscriptions enable row level security;
alter table public.app_push_outbox enable row level security;
revoke all on public.app_push_subscriptions, public.app_push_outbox from anon, authenticated;

create function public.app_push_subscription(p_action text, p_subscription jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); target text := p_subscription ->> 'endpoint'; item public.app_push_subscriptions%rowtype;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  select * into item from public.app_push_subscriptions where endpoint = target for update;
  if p_action = 'get' then
    return jsonb_build_object('subscribed', coalesce(item.user_id = caller, false), 'pokes', case when item.user_id = caller then item.pokes else true end);
  elsif p_action = 'delete' then
    delete from public.app_push_subscriptions where endpoint = target and user_id = caller;
    return jsonb_build_object('subscribed', false);
  elsif p_action is distinct from 'save' then raise exception 'INVALID_INPUT';
  end if;
  if item.id is not null and item.user_id <> caller then raise exception 'SUBSCRIPTION_IN_USE'; end if;
  if item.id is null and (select count(*) from public.app_push_subscriptions where user_id = caller) >= 10 then raise exception 'DEVICE_LIMIT'; end if;
  insert into public.app_push_subscriptions(user_id, endpoint, keys, pokes)
    values(caller, target, p_subscription -> 'keys', coalesce((p_subscription ->> 'pokes')::boolean, true))
    on conflict(endpoint) do update set keys = excluded.keys, pokes = excluded.pokes, updated_at = now()
    where public.app_push_subscriptions.user_id = caller;
  if not found then raise exception 'SUBSCRIPTION_IN_USE'; end if;
  return jsonb_build_object('subscribed', true, 'pokes', coalesce((p_subscription ->> 'pokes')::boolean, true));
end;
$$;

create function public.app_queue_poke_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_push_outbox(subscription_id, event_key, kind, poke_id, actor_id, payload)
    select s.id, 'poke:' || new.id, 'poke', new.id, new.sender_id,
      jsonb_build_object('title', 'AIMers 콕 찌르기',
        'body', coalesce(u.state -> 'profile' ->> 'name', '그룹 친구') || '님이 ' || g.name || ' 그룹에서 기록을 기다리고 있어요.',
        'url', '/#/groups/' || new.group_id, 'tag', 'poke:' || new.id)
    from public.app_push_subscriptions s join public.app_groups g on g.id = new.group_id
      left join public.user_states u on u.user_id = new.sender_id
    where s.user_id = new.recipient_id and s.pokes on conflict do nothing;
  return new;
end;
$$;
create trigger app_poke_push after insert on public.app_pokes for each row execute function public.app_queue_poke_push();

create function public.app_reminder_days(p_state jsonb, p_today date)
returns integer language plpgsql immutable set search_path = '' as $$
declare days integer := (p_state -> 'profile' ->> 'periodDays')::integer;
  start_day date := (p_state -> 'profile' ->> 'startDate')::date; period integer; remaining integer;
begin
  if p_state -> 'profile' ->> 'notify' <> 'true' then return null; end if;
  period := floor((p_today - start_day)::numeric / days)::integer;
  if period < 0 then return null; end if;
  remaining := start_day + (period + 1) * days - 1 - p_today;
  if remaining not between 0 and 2 or exists(select 1 from jsonb_array_elements(p_state -> 'entries') e
    where floor(((e ->> 'date')::date - start_day)::numeric / days)::integer = period) then return null; end if;
  return remaining;
exception when others then return null;
end;
$$;

create function public.app_enqueue_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Seoul')::date; added integer;
begin
  insert into public.app_push_outbox(subscription_id, event_key, kind, payload)
    select sub.id, 'reminder:' || today, 'reminder', jsonb_build_object('title', 'AIMers 기록 알림',
      'body', case when public.app_reminder_days(s.state, today) = 0 then '오늘이 기록 마감일이에요. 이번 기간 경험을 남겨 주세요.'
        else '기록 마감까지 ' || public.app_reminder_days(s.state, today) || '일 남았어요. 이번 기간 경험을 남겨 주세요.' end,
      'url', '/#/records', 'tag', 'reminder:' || today)
    from public.app_push_subscriptions sub join public.user_states s on s.user_id = sub.user_id
    where public.app_reminder_days(s.state, today) is not null on conflict do nothing;
  get diagnostics added = row_count;
  delete from public.app_push_outbox where created_at < now() - interval '7 days';
  return added;
end;
$$;

create function public.app_claim_push(p_actor uuid default null, p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  with candidates as (
    select o.id from public.app_push_outbox o join public.app_push_subscriptions s on s.id = o.subscription_id
    join public.user_states u on u.user_id = s.user_id
    where o.sent_at is null and o.attempts < 5 and o.available_at <= now() and (o.lease_until is null or o.lease_until < now())
      and (p_actor is null or o.actor_id = p_actor)
      and ((o.kind = 'reminder' and o.event_key = 'reminder:' || (now() at time zone 'Asia/Seoul')::date
        and public.app_reminder_days(u.state, (now() at time zone 'Asia/Seoul')::date) is not null)
      or (o.kind = 'poke' and s.pokes and exists(select 1 from public.app_pokes p
        join public.app_memberships sender on sender.group_id = p.group_id and sender.user_id = p.sender_id
        join public.app_memberships recipient on recipient.group_id = p.group_id and recipient.user_id = p.recipient_id
        where p.id = o.poke_id and p.read_at is null
          and p.period = floor(((now() at time zone 'UTC')::date - (u.state -> 'profile' ->> 'startDate')::date)::numeric / (u.state -> 'profile' ->> 'periodDays')::integer)::integer
          and public.app_member_summary(s.user_id, u.state, (now() at time zone 'UTC')::date) ->> 'doneNow' = 'false')))
    order by o.created_at, o.id limit least(greatest(p_limit, 1), 20) for update of o skip locked
  ), claimed as (
    update public.app_push_outbox o set attempts = attempts + 1, lease_until = now() + interval '2 minutes', lease_token = gen_random_uuid()
    from candidates c where o.id = c.id returning o.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'lease', c.lease_token, 'subscriptionId', s.id,
    'subscription', jsonb_build_object('endpoint', s.endpoint, 'keys', s.keys), 'payload', c.payload)), '[]') into result
    from claimed c join public.app_push_subscriptions s on s.id = c.subscription_id;
  return result;
end;
$$;

create function public.app_finish_push(p_id uuid, p_lease uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare sub uuid;
begin
  if p_status not in ('sent', 'gone', 'retry') then raise exception 'INVALID_INPUT'; end if;
  select subscription_id into sub from public.app_push_outbox where id = p_id and lease_token = p_lease and sent_at is null for update;
  if sub is null then return; end if;
  if p_status = 'gone' then delete from public.app_push_subscriptions where id = sub;
  else update public.app_push_outbox set sent_at = case when p_status = 'sent' then now() else null end,
    available_at = now() + make_interval(mins => least(60, power(2, attempts)::integer)), lease_until = null, lease_token = null where id = p_id;
  end if;
end;
$$;

revoke all on function public.app_push_subscription(text, jsonb) from public, anon;
grant execute on function public.app_push_subscription(text, jsonb) to authenticated;
revoke all on function public.app_queue_poke_push(), public.app_reminder_days(jsonb, date), public.app_enqueue_reminders(),
  public.app_claim_push(uuid, integer), public.app_finish_push(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.app_enqueue_reminders(), public.app_claim_push(uuid, integer), public.app_finish_push(uuid, uuid, text) to service_role;
commit;
