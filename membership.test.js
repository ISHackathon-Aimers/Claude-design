import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHandler } from './server.js';
import { SupabaseStore } from './supabase-db.js';
import { hasPremium, PREMIUM_TASKS } from './public/plans.js';

test('membership cannot be granted by a browser and cancellation preserves remaining access', async () => {
  const db = new PGlite();
  const alice = '00000000-0000-4000-8000-000000000001';
  const bob = '00000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      insert into auth.users values ('${alice}'), ('${bob}');`);
    await db.exec(await readFile(new URL('./supabase/migrations/202611080004_premium_membership.sql', import.meta.url), 'utf8'));
    const call = async (fn = 'app_membership', user = alice, role = 'authenticated') => {
      await db.exec(`set role ${role}; set request.jwt.claim.sub = '${user}';`);
      return (await db.query(`select public.${fn}() as value`)).rows[0].value;
    };
    assert.equal((await call()).premium, false);
    await assert.rejects(db.query(`insert into public.app_subscriptions values ('${alice}', 'monthly', now(), now() + interval '1 month', false, now())`), /permission denied/);
    await assert.rejects(db.query('select * from public.app_subscriptions'), /permission denied/);
    await assert.rejects(call('app_membership', alice, 'anon'), /permission denied/);
    await assert.rejects(call('app_membership', ''), /AUTH_REQUIRED/);
    await db.exec(`reset role; insert into public.app_subscriptions(user_id, plan, current_period_end) values ('${alice}', 'annual', now() + interval '1 year');`);
    const active = await call();
    assert.equal(hasPremium(active), true);
    assert.equal(active.plan, 'annual');
    assert.equal((await call('app_membership', bob)).plan, 'free');
    assert.equal((await call('app_cancel_membership', bob)).premium, false);
    const canceled = await call('app_cancel_membership');
    assert.equal(canceled.premium, true);
    assert.equal(canceled.cancelAtPeriodEnd, true);
    assert.equal(canceled.currentPeriodEnd, active.currentPeriodEnd);
    assert.deepEqual(await call('app_cancel_membership'), canceled);
    await db.exec(`reset role; update public.app_subscriptions set current_period_start = now() - interval '2 months', current_period_end = now() - interval '1 month';`);
    assert.equal((await call()).plan, 'free');
    await db.exec(`reset role; update public.app_subscriptions set current_period_start = now() + interval '1 day', current_period_end = now() + interval '1 month';`);
    assert.equal((await call()).premium, false);
  } finally { await db.close(); }
});

test('API gates every premium task on authoritative membership while core diary remains free', async () => {
  let entitlement = { premium: false, plan: 'free' };
  let called = 0; let saved = 0;
  const auth = Object.assign(async () => false, { getUser: async () => ({ id: 'alice' }), isTrustedWrite: async () => true });
  const handler = createHandler({ auth, store: () => ({ membership: async () => entitlement, saveAiRun: async () => { saved++; } }), aiTask: async () => { called++; return { data: {} }; } });
  async function request(task, headers = { 'x-aimers-user': 'alice' }) {
    let status; let body;
    await handler({ url: '/api/ai', method: 'POST', headers, body: { task, input: { premium: true, plan: 'annual' } } }, {
      writeHead: (code) => { status = code; }, end: (value) => { body = JSON.parse(value); },
    });
    return { status, body };
  }
  for (const task of PREMIUM_TASKS) {
    const result = await request(task);
    assert.equal(result.status, 403); assert.equal(result.body.code, 'PREMIUM_REQUIRED');
  }
  assert.equal(called, 0); assert.equal(saved, 0);
  for (const task of ['followup', 'summarize']) assert.equal((await request(task)).status, 200);
  entitlement = { premium: true, plan: 'annual', currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(), cancelAtPeriodEnd: true };
  for (const task of PREMIUM_TASKS) assert.equal((await request(task)).status, 200);
  entitlement.currentPeriodEnd = new Date(Date.now() - 1000).toISOString();
  assert.equal((await request('questions')).status, 403);
  entitlement.currentPeriodEnd = 'invalid';
  assert.equal((await request('questions')).status, 403);
  assert.equal((await request('questions', { 'x-aimers-user': 'bob' })).status, 401);
});

test('Supabase membership operations always use the authenticated owner', async () => {
  const calls = [];
  const store = new SupabaseStore({ rpc: async (...args) => { calls.push(args); return { data: { plan: 'free', premium: false } }; } }, { id: 'alice' });
  assert.throws(() => store.membership('bob'), /계정/);
  assert.throws(() => store.cancelMembership('bob'), /계정/);
  await store.membership('alice'); await store.cancelMembership('alice');
  assert.deepEqual(calls, [['app_membership', {}], ['app_cancel_membership', {}]]);
});
