begin;

create table public.app_push_subscriptions (
  endpoint text primary key check (length(endpoint) <= 2048),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,
  updated_at timestamptz not null default now()
);
create index app_push_subscriptions_user on public.app_push_subscriptions(user_id);
create table public.app_push_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete cascade,
  dedup text not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  sent_at timestamptz
);
create index app_push_jobs_pending on public.app_push_jobs(available_at) where sent_at is null;
alter table public.app_push_subscriptions enable row level security;
alter table public.app_push_jobs enable row level security;
revoke all on public.app_push_subscriptions, public.app_push_jobs from public, anon, authenticated;
grant all on public.app_push_subscriptions, public.app_push_jobs to service_role;

create function public.app_push_subscription(p_action text, p_subscription jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  v_endpoint text := p_subscription ->> 'endpoint';
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  if v_endpoint is null or length(v_endpoint) > 2048 then raise exception 'INVALID_INPUT'; end if;
  if p_action = 'delete' then
    delete from public.app_push_subscriptions s where s.endpoint = v_endpoint and s.user_id = caller;
  elsif p_action = 'save' then
    if v_endpoint !~ '^https://' or length(coalesce(p_subscription -> 'keys' ->> 'p256dh', '')) not between 80 and 100
      or length(coalesce(p_subscription -> 'keys' ->> 'auth', '')) not between 20 and 30 then raise exception 'INVALID_INPUT'; end if;
    if (select count(*) from public.app_push_subscriptions where user_id = caller) >= 10
      and not exists(select 1 from public.app_push_subscriptions s where s.endpoint = v_endpoint and s.user_id = caller)
      then raise exception 'INVALID_INPUT'; end if;
    insert into public.app_push_subscriptions as s(endpoint, user_id, subscription)
      values (v_endpoint, caller, p_subscription) on conflict (endpoint) do update
      set user_id = excluded.user_id, subscription = excluded.subscription, updated_at = now();
  else raise exception 'INVALID_INPUT'; end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.app_push_subscription(text, jsonb) from public, anon;
grant execute on function public.app_push_subscription(text, jsonb) to authenticated;

create function public.app_enqueue_test_push()
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  if not exists(select 1 from public.app_push_subscriptions where user_id = caller) then raise exception 'PUSH_NOT_SUBSCRIBED'; end if;
  if exists(select 1 from public.app_push_jobs where sender_id = caller and dedup like 'test:%'
    and created_at > now() - interval '1 minute') then raise exception 'PUSH_RATE_LIMIT'; end if;
  insert into public.app_push_jobs(user_id, sender_id, dedup, payload)
    values (caller, caller, 'test:' || gen_random_uuid()::text,
      jsonb_build_object('title', 'AIMers', 'body', '테스트 알림이에요. 매일 알림과 콕 찌르기도 이 방식으로 도착해요.', 'url', '/#/profile'));
end;
$$;
revoke all on function public.app_enqueue_test_push() from public, anon;
grant execute on function public.app_enqueue_test_push() to authenticated;

create function public.app_enqueue_poke_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sender_name text; group_name text;
begin
  select state -> 'profile' ->> 'name' into sender_name from public.user_states where user_id = new.sender_id;
  select name into group_name from public.app_groups where id = new.group_id;
  insert into public.app_push_jobs(user_id, sender_id, dedup, payload)
    values (new.recipient_id, new.sender_id, 'poke:' || new.id::text,
      jsonb_build_object('title', 'AIMers', 'body', coalesce(sender_name, '친구') || '님이 ' || group_name || ' 그룹에서 콕 찔렀어요. 기록을 남겨 주세요.',
        'url', '/#/groups/' || new.group_id::text, 'tag', 'poke:' || new.id::text)) on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.app_enqueue_poke_push() from public, anon, authenticated;
create trigger app_poke_push after insert or update of created_at on public.app_pokes
  for each row execute function public.app_enqueue_poke_push();

create function public.app_enqueue_daily_push()
returns void language plpgsql security definer set search_path = '' as $$
declare day_key text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD');
begin
  insert into public.app_push_jobs(user_id, dedup, payload)
    select s.user_id, 'daily:' || s.user_id::text || ':' || day_key,
      jsonb_build_object('title', 'AIMers', 'body', '오늘의 경험을 기록할 시간이에요. 짧은 기록 하나를 남겨 보세요.',
        'url', '/#/dashboard', 'tag', 'daily:' || day_key)
    from public.user_states s where s.state -> 'profile' ->> 'notify' = 'true'
      and exists(select 1 from public.app_push_subscriptions p where p.user_id = s.user_id)
    on conflict do nothing;
  delete from public.app_push_jobs where created_at < now() - interval '7 days';
end;
$$;

create function public.app_claim_push_jobs(p_sender uuid default null, p_limit integer default 50)
returns setof public.app_push_jobs language sql security definer set search_path = '' as $$
  update public.app_push_jobs j set attempts = attempts + 1, available_at = now() + interval '5 minutes'
    where j.id in (select id from public.app_push_jobs
      where sent_at is null and attempts < 5 and available_at <= now()
        and created_at > now() - interval '1 day' and (p_sender is null or sender_id = p_sender)
      order by created_at limit least(greatest(p_limit, 1), 100) for update skip locked)
    returning j.*;
$$;
revoke all on function public.app_enqueue_daily_push(), public.app_claim_push_jobs(uuid, integer) from public, anon, authenticated;
grant execute on function public.app_enqueue_daily_push(), public.app_claim_push_jobs(uuid, integer) to service_role;

commit;
