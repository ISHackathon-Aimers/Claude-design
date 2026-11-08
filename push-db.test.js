import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { defaultProfile } from './state.js';

test('push migration protects subscriptions, deduplicates jobs and honors reminder and poke preferences', async () => {
  const db = new PGlite();
  const [alice, bob, other] = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      insert into auth.users values ('${alice}'), ('${bob}'), ('${other}');`);
    for (const name of ['202611080001_user_states.sql', '202611080002_main_features.sql', '202611080003_web_push.sql']) {
      await db.exec(await readFile(new URL(`./supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    const today = (await db.query("select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') as today")).rows[0].today;
    const startDate = new Date(Date.parse(`${today}T00:00:00Z`) - 4 * 86400000).toISOString().slice(0, 10);
    const state = { v: 1, profile: { ...defaultProfile('Alice'), startDate, notify: true }, entries: [], categories: ['프로젝트'], groups: [] };
    for (const id of [alice, bob, other]) await db.query('insert into public.user_states(user_id, state) values ($1, $2::jsonb)', [id, JSON.stringify({ ...state, profile: { ...state.profile, notify: id === alice } })]);
    const call = async (name, args, user = alice, role = 'authenticated') => {
      await db.exec(`set role ${role}; set request.jwt.claim.sub = '${user}';`);
      const params = Object.entries(args);
      const values = params.map(([, value]) => value !== null && typeof value === 'object' ? JSON.stringify(value) : value);
      const types = { p_action: 'text', p_subscription: 'jsonb', p_payload: 'jsonb', p_actor: 'uuid', p_limit: 'integer', p_id: 'uuid', p_lease: 'uuid', p_status: 'text' };
      return (await db.query(`select public.${name}(${params.map(([key], i) => `${key} => $${i + 1}::${types[key]}`).join(',')}) as value`, values)).rows[0].value;
    };
    const subscription = (suffix) => ({ endpoint: `https://web.push.apple.com/${suffix}`, keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) }, pokes: true });
    const aSub = subscription('alice'); const bSub = subscription('bob');
    await call('app_push_subscription', { p_action: 'save', p_subscription: aSub });
    await call('app_push_subscription', { p_action: 'save', p_subscription: bSub }, bob);
    assert.equal((await call('app_push_subscription', { p_action: 'get', p_subscription: aSub }, bob)).subscribed, false);
    await assert.rejects(call('app_push_subscription', { p_action: 'save', p_subscription: aSub }, bob), /SUBSCRIPTION_IN_USE/);
    await assert.rejects(call('app_push_subscription', { p_action: 'save', p_subscription: { ...aSub, endpoint: 'https://127.0.0.1/private' } }), /check constraint/);
    await call('app_push_subscription', { p_action: 'delete', p_subscription: aSub }, bob);
    assert.equal((await call('app_push_subscription', { p_action: 'get', p_subscription: aSub })).subscribed, true);
    await assert.rejects(db.query('select * from public.app_push_subscriptions'), /permission denied/);
    await assert.rejects(call('app_claim_push', { p_actor: null, p_limit: 10 }), /permission denied/);
    const group = await call('app_group_action', { p_action: 'create', p_payload: { name: 'Push group' } });
    await db.exec('reset role;');
    const code = (await db.query('select code from public.app_groups where id = $1', [group.id])).rows[0].code;
    await call('app_group_action', { p_action: 'join', p_payload: { code } }, bob);
    const poke = () => call('app_group_action', { p_action: 'poke', p_payload: { groupId: group.id, recipientId: bob } });
    await poke(); await poke();
    await call('app_push_subscription', { p_action: 'save', p_subscription: { ...bSub, pokes: false } }, bob);
    const claim = (actor = null) => call('app_claim_push', { p_actor: actor, p_limit: 10 }, alice, 'service_role');
    assert.deepEqual(await claim(alice), []);
    await call('app_push_subscription', { p_action: 'save', p_subscription: bSub }, bob);
    assert.deepEqual(await claim(other), []);
    let jobs = await claim(alice);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].subscription.endpoint, bSub.endpoint);
    assert.equal(jobs[0].payload.url, `/#/groups/${group.id}`);
    assert.deepEqual(await claim(alice), []);
    const finish = (job, status) => call('app_finish_push', { p_id: job.id, p_lease: job.lease, p_status: status }, alice, 'service_role');
    await finish(jobs[0], 'sent');
    assert.equal(await call('app_enqueue_reminders', {}, alice, 'service_role'), 1);
    assert.equal(await call('app_enqueue_reminders', {}, alice, 'service_role'), 0);
    // Filling this period after enqueue must suppress a stale reminder.
    await db.exec('reset role;');
    const entry = { id: 'entry1', date: today, category: '프로젝트', title: 'Done', summary: 'Done', raw: '', qa: [], tags: [] };
    await db.query('update public.user_states set state = $1::jsonb where user_id = $2', [JSON.stringify({ ...state, entries: [entry] }), alice]);
    assert.deepEqual(await claim(), []);
    await db.exec('reset role;');
    await db.query('update public.user_states set state = $1::jsonb where user_id = $2', [JSON.stringify(state), alice]);
    jobs = await claim();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].payload.title, 'AIMers 기록 알림');
    await finish(jobs[0], 'retry');
    assert.deepEqual(await claim(), []);
    await db.exec('reset role;');
    await db.exec("update public.app_push_outbox set available_at = now() - interval '1 minute' where sent_at is null;");
    jobs = await claim();
    await finish(jobs[0], 'gone');
    assert.equal((await call('app_push_subscription', { p_action: 'get', p_subscription: aSub })).subscribed, false);
    await db.exec('set role anon;');
    await assert.rejects(db.query('select public.app_enqueue_reminders()'), /permission denied/);
  } finally { await db.close(); }
});
