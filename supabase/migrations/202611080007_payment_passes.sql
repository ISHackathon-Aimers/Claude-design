begin;

create table public.app_payment_orders (
  id text primary key check (id ~ '^aimers-[a-f0-9-]{36}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('monthly', 'annual')),
  amount integer not null,
  store_id text not null,
  channel_key text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIAL_REFUNDED')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  check ((plan = 'monthly' and amount = 2990) or (plan = 'annual' and amount = 29900))
);
create index app_payment_orders_user on public.app_payment_orders(user_id, paid_at);
alter table public.app_payment_orders enable row level security;
revoke all on public.app_payment_orders from public, anon, authenticated;
grant select, insert, update on public.app_payment_orders to service_role;

create function public.app_payment_create(p_id text, p_user uuid, p_plan text, p_store text, p_channel text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.app_payment_orders;
begin
  if p_plan not in ('monthly', 'annual') or p_store is null or p_channel is null then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 47));
  select * into result from public.app_payment_orders
    where user_id = p_user and plan = p_plan and status = 'PENDING' and store_id = p_store and channel_key = p_channel
      and created_at > now() - interval '30 minutes' order by created_at desc limit 1;
  if not found then
    insert into public.app_payment_orders(id, user_id, plan, amount, store_id, channel_key)
      values (p_id, p_user, p_plan, case p_plan when 'monthly' then 2990 else 29900 end, p_store, p_channel) returning * into result;
  end if;
  return to_jsonb(result);
end;
$$;

create function public.app_payment_order(p_id text, p_user uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select to_jsonb(o) from public.app_payment_orders o where id = p_id and (p_user is null or user_id = p_user);
$$;

create function public.app_payment_apply(p_id text, p_status text, p_paid_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.app_payment_orders; item public.app_payment_orders; next_start timestamptz; next_end timestamptz; manual_end timestamptz;
begin
  if p_status not in ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIAL_REFUNDED') then raise exception 'INVALID_INPUT'; end if;
  select * into target from public.app_payment_orders where id = p_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target.user_id::text, 47));
  select * into target from public.app_payment_orders where id = p_id for update;
  if p_status in ('PAID', 'PARTIAL_REFUNDED') and (p_paid_at is null or p_paid_at > now() + interval '5 minutes') then raise exception 'INVALID_INPUT'; end if;
  -- Refund is terminal. Old callbacks can never resurrect a revoked entitlement.
  if target.status <> 'REFUNDED' and not (target.status in ('PAID', 'PARTIAL_REFUNDED') and p_status in ('PENDING', 'FAILED')) and not (target.status = 'PARTIAL_REFUNDED' and p_status = 'PAID') then
    update public.app_payment_orders set status = p_status, paid_at = coalesce(paid_at, p_paid_at) where id = p_id;
  end if;
  -- Purchased passes are separate from administrator grants. Recompute from paid
  -- orders on refunds, so duplicate callbacks never extend a pass twice.
  select current_period_end into manual_end from public.app_subscriptions where user_id = target.user_id and current_period_start <= now();
  update public.app_payment_orders set period_start = null, period_end = null where user_id = target.user_id;
  for item in select * from public.app_payment_orders where user_id = target.user_id and status in ('PAID', 'PARTIAL_REFUNDED') order by paid_at, created_at, id loop
    next_start := greatest(item.paid_at, next_end, manual_end);
    next_end := ((next_start at time zone 'Asia/Seoul') + case item.plan when 'monthly' then interval '1 month' else interval '1 year' end) at time zone 'Asia/Seoul';
    update public.app_payment_orders set period_start = next_start, period_end = next_end where id = item.id;
  end loop;
  select * into target from public.app_payment_orders where id = p_id;
  return jsonb_build_object('paymentId', target.id, 'status', target.status);
end;
$$;

create or replace function public.app_membership()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); entitlement record; active boolean; purchased_end timestamptz;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  select plan, period_end into entitlement from (
    select plan, current_period_start as period_start, current_period_end as period_end from public.app_subscriptions where user_id = caller
    union all
    select plan, period_start, period_end from public.app_payment_orders where user_id = caller and status in ('PAID', 'PARTIAL_REFUNDED')
  ) rights where period_start <= now() and period_end > now() order by period_end desc limit 1;
  active := found;
  if active then
    select max(period_end) into purchased_end from public.app_payment_orders where user_id = caller and status in ('PAID', 'PARTIAL_REFUNDED');
    entitlement.period_end := greatest(entitlement.period_end, purchased_end);
  end if;
  return jsonb_build_object('premium', active, 'plan', coalesce(entitlement.plan, 'free'), 'currentPeriodEnd', entitlement.period_end, 'cancelAtPeriodEnd', false, 'checkoutEnabled', false);
end;
$$;

revoke all on function public.app_payment_create(text, uuid, text, text, text), public.app_payment_order(text, uuid), public.app_payment_apply(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.app_payment_create(text, uuid, text, text, text), public.app_payment_order(text, uuid), public.app_payment_apply(text, text, timestamptz) to service_role;
-- Fixed-term passes have no subscription cancellation operation.
revoke execute on function public.app_cancel_membership() from authenticated;
commit;
