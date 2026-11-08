begin;

-- Entitlements are granted only by a trusted administrator/service. User state and
-- editable auth metadata must never be used as the source of paid access.
create table public.app_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null check (plan in ('monthly', 'annual')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now(),
  check (current_period_end > current_period_start)
);
alter table public.app_subscriptions enable row level security;
revoke all on public.app_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.app_subscriptions to service_role;

create function public.app_membership()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); subscription public.app_subscriptions; active boolean;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into subscription from public.app_subscriptions where user_id = caller;
  active := coalesce(subscription.current_period_start <= now() and subscription.current_period_end > now(), false);
  return jsonb_build_object(
    'premium', active, 'plan', case when active then subscription.plan else 'free' end,
    'currentPeriodEnd', case when active then subscription.current_period_end else null end,
    'cancelAtPeriodEnd', case when active then subscription.cancel_at_period_end else false end,
    'checkoutEnabled', false
  );
end;
$$;

-- No payment provider is connected yet. This schedules expiration of a manually
-- granted entitlement; it does not claim to cancel an external payment contract.
create function public.app_cancel_membership()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.app_subscriptions set cancel_at_period_end = true, updated_at = now()
    where user_id = caller and current_period_start <= now() and current_period_end > now();
  return public.app_membership();
end;
$$;

revoke all on function public.app_membership(), public.app_cancel_membership() from public, anon;
grant execute on function public.app_membership(), public.app_cancel_membership() to authenticated;
commit;
