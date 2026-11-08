begin;

-- Keep existing devices and pending deliveries when importing the worktree features.
alter table public.app_push_outbox drop constraint app_push_outbox_kind_check;
alter table public.app_push_outbox add constraint app_push_outbox_kind_check check (kind in ('reminder', 'poke', 'test'));

create or replace function public.app_queue_poke_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_push_outbox(subscription_id, event_key, kind, poke_id, actor_id, payload)
    select s.id, 'poke:' || new.id || ':' || new.created_at::text, 'poke', new.id, new.sender_id,
      jsonb_build_object('title', 'AIMers 콕 찌르기',
        'body', coalesce(u.state -> 'profile' ->> 'name', '그룹 친구') || '님이 ' || g.name || ' 그룹에서 기록을 기다리고 있어요.',
        'url', '/#/groups/' || new.group_id, 'tag', 'poke:' || new.id)
    from public.app_push_subscriptions s join public.app_groups g on g.id = new.group_id
      left join public.user_states u on u.user_id = new.sender_id
    where s.user_id = new.recipient_id and s.pokes on conflict do nothing;
  return new;
end;
$$;
drop trigger app_poke_push on public.app_pokes;
create trigger app_poke_push after insert or update of created_at on public.app_pokes for each row execute function public.app_queue_poke_push();


create or replace function public.app_enqueue_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Seoul')::date; added integer;
begin
  insert into public.app_push_outbox(subscription_id, event_key, kind, payload)
    select sub.id, 'reminder:' || today, 'reminder', jsonb_build_object('title', 'AIMers 기록 알림',
      'body', '오늘의 경험을 기록할 시간이에요. 짧은 기록 하나를 남겨 보세요.',
      'url', '/#/dashboard', 'tag', 'reminder:' || today)
    from public.app_push_subscriptions sub join public.user_states s on s.user_id = sub.user_id
    where s.state -> 'profile' ->> 'notify' = 'true' on conflict do nothing;
  get diagnostics added = row_count;
  delete from public.app_push_outbox where created_at < now() - interval '7 days';
  return added;
end;
$$;

create function public.app_enqueue_test_push()
returns integer language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); added integer;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  if not exists(select 1 from public.app_push_subscriptions where user_id = caller) then raise exception 'PUSH_NOT_SUBSCRIBED'; end if;
  if exists(select 1 from public.app_push_outbox where actor_id = caller and kind = 'test'
    and created_at > now() - interval '1 minute') then raise exception 'PUSH_RATE_LIMIT'; end if;
  insert into public.app_push_outbox(subscription_id, event_key, kind, actor_id, payload)
    select s.id, 'test:' || gen_random_uuid(), 'test', caller,
      jsonb_build_object('title', 'AIMers', 'body', '테스트 알림이에요. 매일 기록 알림과 콕 찌르기도 이 방식으로 도착해요.', 'url', '/#/profile')
    from public.app_push_subscriptions s where s.user_id = caller;
  get diagnostics added = row_count;
  return added;
end;
$$;
revoke all on function public.app_enqueue_test_push() from public, anon;
grant execute on function public.app_enqueue_test_push() to authenticated;

create or replace function public.app_claim_push(p_actor uuid default null, p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  with candidates as (
    select o.id from public.app_push_outbox o join public.app_push_subscriptions s on s.id = o.subscription_id
    join public.user_states u on u.user_id = s.user_id
    where o.created_at > now() - interval '1 day' and o.sent_at is null and o.attempts < 5 and o.available_at <= now() and (o.lease_until is null or o.lease_until < now())
      and (p_actor is null or o.actor_id = p_actor)
      and ((o.kind = 'reminder' and o.event_key = 'reminder:' || (now() at time zone 'Asia/Seoul')::date
        and u.state -> 'profile' ->> 'notify' = 'true')
      or (o.kind = 'test' and o.actor_id = s.user_id)
      or (o.kind = 'poke' and s.pokes and exists(select 1 from public.app_pokes p
        join public.app_memberships sender on sender.group_id = p.group_id and sender.user_id = p.sender_id
        join public.app_memberships recipient on recipient.group_id = p.group_id and recipient.user_id = p.recipient_id
        where p.id = o.poke_id and p.read_at is null and o.created_at >= p.created_at
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

commit;
