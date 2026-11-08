import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import vm from 'node:vm';
import http from 'node:http';
import { createHandler } from './server.js';
import { enablePush, disablePush, preparePush, pushSupport } from './public/push.js';
import { defaultProfile } from './state.js';
import { deliverPush, validateSubscription, validCron, pushConfig, dispatchPush } from './push.js';

const subscription = { endpoint: 'https://web.push.apple.com/test-device', keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } };

test('push validates destinations, keeps private keys out of config and authenticates cron', () => {
  assert.deepEqual(validateSubscription(subscription), subscription);
  for (const endpoint of ['http://web.push.apple.com/x', 'https://127.0.0.1/x', 'https://web.push.apple.com.attacker.com/x', 'https://user@web.push.apple.com/x']) {
    assert.throws(() => validateSubscription({ ...subscription, endpoint }), { status: 400 });
  }
  const env = { VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: 'mailto:a@example.com', SUPABASE_SERVICE_ROLE_KEY: 'secret', SUPABASE_URL: 'https://example.supabase.co', CRON_SECRET: 'cron' };
  assert.deepEqual(pushConfig(env), { enabled: true, publicKey: 'public' });
  assert.equal(validCron({ headers: { authorization: 'Bearer cron' } }, env), true);
  assert.equal(validCron({ headers: { authorization: 'Bearer wrong' } }, env), false);
  assert.equal(validCron({ headers: {} }, {}), false);
});

test('push sends an audible notification payload, removes expired subscriptions and retries temporary failures', async () => {
  let removed;
  const client = { from: () => ({ delete: () => ({ eq: async (_, endpoint) => { removed = endpoint; return { error: null }; } }) }) };
  let options;
  assert.equal(await deliverPush(client, subscription, { body: 'Reminder' }, { env: {}, send: async (sub, body, opts) => {
    assert.equal(sub, subscription); assert.equal(JSON.parse(body).body, 'Reminder'); options = opts;
  } }), true);
  assert.equal(options.TTL, 3600);
  assert.equal(await deliverPush(client, subscription, {}, { send: async () => { throw { statusCode: 410 }; } }), true);
  assert.equal(removed, subscription.endpoint);
  assert.equal(await deliverPush(client, subscription, {}, { send: async () => { throw { statusCode: 503 }; } }), false);
});

test('push dispatcher sends only claimed jobs and leaves failed jobs available for retry', async () => {
  let claims = 0; const completed = [];
  const client = {
    rpc: async (name, args) => {
      assert.equal(name, 'app_claim_push_jobs'); assert.equal(args.p_sender, 'sender');
      return { data: claims++ ? [] : [{ id: 'ok', user_id: 'recipient', payload: {} }, { id: 'retry', user_id: 'recipient', payload: { fail: true } }] };
    },
    from: (table) => table === 'app_push_subscriptions'
      ? { select: () => ({ eq: async () => ({ data: [{ subscription }] }) }) }
      : { update: () => ({ eq: async (_, id) => { completed.push(id); return {}; } }) },
  };
  assert.deepEqual(await dispatchPush({ sender: 'sender', client, deliver: async (_, sub, payload) => !payload.fail }), { sent: 1 });
  assert.deepEqual(completed, ['ok']);
});

test('service worker displays pushes with sound enabled and opens the matching app page', async () => {
  const handlers = {}; let shown, opened;
  const self = { addEventListener: (type, fn) => { handlers[type] = fn; },
    registration: { showNotification: async (title, options) => { shown = { title, options }; } },
    location: { origin: 'https://aimers.example' },
    clients: { matchAll: async () => [], openWindow: async (url) => { opened = url; } },
  };
  vm.runInNewContext(await readFile(new URL('./public/sw.js', import.meta.url), 'utf8'), { self, URL });
  let pending;
  handlers.push({ data: { json: () => ({ body: 'Poke', url: '/#/groups/friends' }) }, waitUntil: (value) => { pending = value; } });
  await pending;
  assert.equal(shown.options.silent, false);
  assert.equal(shown.options.body, 'Poke');
  handlers.notificationclick({ notification: { data: shown.options.data, close() {} }, waitUntil: (value) => { pending = value; } });
  await pending; assert.equal(opened, 'https://aimers.example/#/groups/friends');
  handlers.push({ data: { json: () => { throw new Error('Invalid JSON'); } }, waitUntil: (value) => { pending = value; } });
  await pending; assert.equal(shown.title, 'AIMers');
});

test('browser guides iPhone installation, requests permission from the click, and persists or deletes its subscription', async (t) => {
  const old = Object.fromEntries(['navigator', 'window', 'Notification'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of Object.entries(old)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  let installed = false, allowed = true, unsubscribed = false, permissionRequested = false;
  const local = { endpoint: subscription.endpoint, toJSON: () => subscription, unsubscribe: async () => { unsubscribed = true; } };
  const manager = { getSubscription: async () => null, subscribe: async (options) => {
    assert.equal(options.userVisibleOnly, true); return local;
  } };
  const registration = { pushManager: manager };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'iPhone',
    serviceWorker: { register: async () => registration, ready: Promise.resolve(registration), getRegistration: async () => registration } } });
  globalThis.window = { isSecureContext: true, PushManager: {}, Notification: {}, matchMedia: () => ({ matches: installed }) };
  globalThis.Notification = { requestPermission: () => { permissionRequested = true; return Promise.resolve(allowed ? 'granted' : 'denied'); } };
  assert.match(pushSupport(), /홈 화면/);
  await assert.rejects(enablePush(() => {}), /홈 화면/);
  installed = true;
  const requests = [];
  const api = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/config')) return { enabled: true, publicKey: 'AQID' };
    return { ok: true };
  };
  await preparePush(api);
  const enabling = enablePush(api);
  assert.equal(permissionRequested, true);
  await enabling;
  assert.equal(requests.at(-1).options.method, 'POST');
  assert.deepEqual(requests.at(-1).options.body, subscription);
  allowed = false;
  await assert.rejects(enablePush(api), /권한/);
  manager.getSubscription = async () => local;
  await disablePush(api);
  assert.equal(requests.at(-1).options.method, 'DELETE'); assert.equal(unsubscribed, true);
});

test('HTTP cron requires its own secret and never falls through to user authentication', async (t) => {
  const before = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-cron-secret';
  t.after(() => { if (before === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = before; });
  let dispatched = 0;
  const handler = createHandler({ auth: () => { assert.fail('cron should not use browser auth'); }, pushDispatch: async (options) => {
    assert.equal(options.daily, true); dispatched++; return { sent: 1 };
  } });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/api/cron/push`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { authorization: 'Bearer bad' } })).status, 401);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  const response = await fetch(url, { headers: { authorization: 'Bearer test-cron-secret' } });
  assert.deepEqual(await response.json(), { sent: 1 }); assert.equal(dispatched, 1);
});

test('Postgres push permissions, daily deduplication, poke cooldown and job leases', async () => {
  const db = new PGlite();
  const alice = '00000000-0000-4000-8000-000000000001', bob = '00000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      insert into auth.users values ('${alice}'), ('${bob}');`);
    for (const migration of ['202611080001_user_states', '202611080002_main_features', '202611080003_poke_cooldown', '202611080004_web_push']) {
      await db.exec(await readFile(new URL(`./supabase/migrations/${migration}.sql`, import.meta.url), 'utf8'));
    }
    for (const id of [alice, bob]) {
      await db.query('insert into public.user_states(user_id, state) values ($1, $2)', [id, JSON.stringify({ v: 1, profile: { ...defaultProfile('Member'), notify: true }, entries: [], categories: ['프로젝트'], groups: [], lastNotified: '' })]);
    }
    const login = (id) => db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${id}';`);
    await login(bob);
    await db.query("select public.app_push_subscription('save', $1)", [JSON.stringify(subscription)]);
    await assert.rejects(db.query('select * from public.app_push_subscriptions'), /permission denied/);
    await assert.rejects(db.query('select public.app_enqueue_daily_push()'), /permission denied/);
    await assert.rejects(db.query('select public.app_claim_push_jobs()'), /permission denied/);
    await db.query('select public.app_enqueue_test_push()');
    await assert.rejects(db.query('select public.app_enqueue_test_push()'), /PUSH_RATE_LIMIT/);
    await login(alice);
    const group = (await db.query("select public.app_group_action('create', '{\"name\":\"Friends\"}') as value")).rows[0].value.id;
    await db.exec('reset role');
    const code = (await db.query('select code from public.app_groups where id = $1', [group])).rows[0].code;
    await login(bob);
    await db.query("select public.app_group_action('join', $1)", [JSON.stringify({ code })]);
    await login(alice);
    const poke = () => db.query("select public.app_group_action('poke', $1)", [JSON.stringify({ groupId: group, recipientId: bob })]);
    await poke(); await poke();
    await db.exec('reset role');
    const count = async (prefix) => Number((await db.query('select count(*) as n from public.app_push_jobs where dedup like $1', [`${prefix}:%`])).rows[0].n);
    assert.equal(await count('poke'), 1);
    // Timestamp-only changes used by this test also run the production trigger.
    await db.exec('alter table public.app_pokes disable trigger app_poke_push');
    await db.query("update public.app_pokes set created_at = now() - interval '299 seconds'");
    await db.exec('alter table public.app_pokes enable trigger app_poke_push');
    await login(alice); await poke();
    await db.exec('reset role'); assert.equal(await count('poke'), 1);
    await db.exec('alter table public.app_pokes disable trigger app_poke_push');
    await db.query("update public.app_pokes set created_at = now() - interval '300 seconds'");
    await db.exec('alter table public.app_pokes enable trigger app_poke_push');
    await login(alice); await poke();
    const state = (await db.query('select public.app_state((select state from public.user_states where user_id = $1), current_date) as value', [alice])).rows[0].value;
    assert.equal(typeof state.state.pokes[`${group}:${bob}`], 'number');
    await db.exec('reset role'); assert.equal(await count('poke'), 2);
    await db.exec('set role service_role');
    await db.query('select public.app_enqueue_daily_push()'); await db.query('select public.app_enqueue_daily_push()');
    assert.equal(await count('daily'), 1);
    const claimed = (await db.query('select * from public.app_claim_push_jobs($1, 10)', [alice])).rows;
    assert.equal(claimed.length, 2);
    assert.equal((await db.query('select * from public.app_claim_push_jobs($1, 10)', [alice])).rows.length, 0);
    await login(alice);
    await db.query("select public.app_push_subscription('delete', $1)", [JSON.stringify({ endpoint: subscription.endpoint })]);
    await db.exec('reset role');
    assert.equal(Number((await db.query('select count(*) as n from public.app_push_subscriptions')).rows[0].n), 1);
  } finally { await db.close(); }
});
