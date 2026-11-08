import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { defaultProfile } from './state.js';

test('notification worktree upgrades preserve existing devices and add repeat pokes, daily reminders and owner-only test pushes', async () => {
  const db = new PGlite();
  const [alice, bob, other] = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      insert into auth.users values ('${alice}'), ('${bob}'), ('${other}');`);
    const migration = async (name) => db.exec(await readFile(new URL(`./supabase/migrations/${name}`, import.meta.url), 'utf8'));
    for (const name of ['202611080001_user_states.sql', '202611080002_main_features.sql', '202611080003_web_push.sql', '202611080004_premium_membership.sql']) await migration(name);
    const call = async (name, args = {}, user = alice, role = 'authenticated') => {
      await db.exec(`set role ${role}; set request.jwt.claim.sub = '${user}';`);
      const params = Object.entries(args);
      const types = { p_action: 'text', p_subscription: 'jsonb', p_payload: 'jsonb', p_actor: 'uuid', p_limit: 'integer', p_id: 'uuid', p_lease: 'uuid', p_status: 'text', p_default: 'jsonb', p_today: 'date' };
      return (await db.query(`select public.${name}(${params.map(([key], i) => `${key} => $${i + 1}::${types[key]}`).join(',')}) as value`, params.map(([, value]) => value && typeof value === 'object' ? JSON.stringify(value) : value))).rows[0].value;
    };
    const today = (await db.query("select to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as day")).rows[0].day;
    const state = { v: 1, profile: { ...defaultProfile('Member'), startDate: today, notify: true }, entries: [], categories: ['프로젝트'], groups: [] };
    for (const id of [alice, bob, other]) await db.query('insert into public.user_states(user_id, state) values ($1, $2::jsonb)', [id, JSON.stringify(state)]);
    const subscription = (id) => ({ endpoint: `https://web.push.apple.com/${id}`, keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) }, pokes: true });
    await call('app_push_subscription', { p_action: 'save', p_subscription: subscription('alice') });
    await call('app_push_subscription', { p_action: 'save', p_subscription: subscription('bob') }, bob);
    const group = await call('app_group_action', { p_action: 'create', p_payload: { name: 'Merge test' } });
    await db.exec('reset role');
    const code = (await db.query('select code from public.app_groups where id = $1', [group.id])).rows[0].code;
    await call('app_group_action', { p_action: 'join', p_payload: { code } }, bob);
    const poke = () => call('app_group_action', { p_action: 'poke', p_payload: { groupId: group.id, recipientId: bob } });
    await poke();
    await db.exec('reset role');
    const originalPoke = (await db.query('select id from public.app_pokes')).rows[0].id;
    const originalDevice = (await db.query('select id from public.app_push_subscriptions order by endpoint')).rows[0].id;
    await migration('202611080005_poke_cooldown.sql');
    await migration('202611080006_notification_updates.sql');
    assert.equal((await db.query('select id from public.app_push_subscriptions order by endpoint')).rows[0].id, originalDevice);
    const groupState = await call('app_state', { p_default: state, p_today: today });
    assert.equal(typeof groupState.state.pokes[`${group.id}:${bob}`], 'number');
    await poke();
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as n from public.app_push_outbox')).rows[0].n, 1);
    const claim = (actor = null) => call('app_claim_push', { p_actor: actor, p_limit: 10 }, alice, 'service_role');
    assert.equal((await claim(alice)).length, 1); // A queued notification from before the migration still works.
    await db.exec(`reset role; alter table public.app_pokes disable trigger app_poke_push;
      update public.app_pokes set created_at = now() - interval '6 minutes';
      alter table public.app_pokes enable trigger app_poke_push;`);
    await poke();
    await db.exec('reset role');
    assert.equal((await db.query('select id from public.app_pokes')).rows[0].id, originalPoke);
    assert.equal((await db.query('select count(*)::int as n from public.app_push_outbox')).rows[0].n, 2);
    await db.exec("update public.app_push_outbox set lease_until = null, available_at = now() - interval '1 minute'");
    const newPokes = await claim(alice);
    assert.equal(newPokes.length, 1); // A delayed previous poke cannot be resent after a new poke.
    await call('app_finish_push', { p_id: newPokes[0].id, p_lease: newPokes[0].lease, p_status: 'sent' }, alice, 'service_role');
    await db.exec('reset role');
    const completed = { ...state, entries: [{ id: 'entry1', date: today, category: '프로젝트', title: 'Done', summary: 'Done', raw: '', qa: [], tags: [] }] };
    await db.query('update public.user_states set state = $1::jsonb', [JSON.stringify(completed)]);
    assert.equal(await call('app_enqueue_reminders', {}, alice, 'service_role'), 2); // Daily even on completed days.
    assert.equal(await call('app_enqueue_reminders', {}, alice, 'service_role'), 0);
    await db.exec(`reset role; update public.user_states set state = jsonb_set(state, '{profile,notify}', 'false'::jsonb) where user_id = '${bob}'`);
    const daily = await claim();
    assert.equal(daily.length, 1);
    assert.equal(daily[0].payload.url, '/#/dashboard');
    await call('app_finish_push', { p_id: daily[0].id, p_lease: daily[0].lease, p_status: 'sent' }, alice, 'service_role');
    await assert.rejects(call('app_enqueue_test_push', {}, other), /PUSH_NOT_SUBSCRIBED/);
    await assert.rejects(call('app_enqueue_test_push', {}, alice, 'anon'), /permission denied/);
    assert.equal(await call('app_enqueue_test_push'), 1);
    await assert.rejects(call('app_enqueue_test_push'), /PUSH_RATE_LIMIT/);
    assert.deepEqual(await claim(bob), []);
    const ownTest = await claim(alice);
    assert.equal(ownTest.length, 1);
    assert.equal(ownTest[0].subscription.endpoint, subscription('alice').endpoint);
    assert.equal(ownTest[0].payload.url, '/#/profile');
  } finally { await db.close(); }
});
