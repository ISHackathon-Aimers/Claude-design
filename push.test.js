import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cronAuthorized, createPushService, pushConfig, validateSubscription } from './push.js';
import { createHandler } from './server.js';

test('push configuration never exposes server keys and cron access fails closed', () => {
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'private-db-key', VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private-vapid', VAPID_SUBJECT: 'https://example.com', CRON_SECRET: 'long-random-secret-value' };
  assert.deepEqual(pushConfig(env), { enabled: true, publicKey: 'public' });
  assert.deepEqual(pushConfig({ ...env, SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: 'legacy-private-key' }), { enabled: true, publicKey: 'public' });
  assert.equal(cronAuthorized({ headers: {} }, env), false);
  assert.equal(cronAuthorized({ headers: { authorization: `Bearer ${env.CRON_SECRET}` } }, env), true);
  assert.equal(cronAuthorized({ headers: { authorization: 'Bearer wrong' } }, env), false);
  assert.equal(cronAuthorized({ headers: {} }, {}), false);
});

test('test push authenticates the owner, rejects untrusted writes and honors server configuration', async () => {
  let trusted = true; let enabled = true;
  const queued = []; const drained = [];
  const auth = Object.assign(async () => false, { getUser: async () => ({ id: 'alice' }), isTrustedWrite: async () => trusted });
  const handler = createHandler({ auth, push: { config: () => ({ enabled }), drain: async (id) => { drained.push(id); return { sent: 1, failed: 0, expired: 0 }; } },
    store: () => ({ enqueueTestPush: async (id) => { queued.push(id); } }) });
  const request = async (method = 'POST', user = 'alice') => {
    let status; let body;
    await handler({ url: '/api/push/test', method, headers: { 'x-aimers-user': user } }, { writeHead: (value) => { status = value; }, end: (value) => { body = JSON.parse(value); } });
    return { status, body };
  };
  assert.equal((await request('GET')).status, 405);
  assert.equal((await request('POST', 'bob')).status, 401);
  trusted = false;
  assert.equal((await request()).status, 403);
  trusted = true; enabled = false;
  assert.equal((await request()).status, 503);
  assert.equal(queued.length, 0);
  enabled = true;
  assert.equal((await request()).body.sent, 1);
  assert.deepEqual(queued, ['alice']); assert.deepEqual(drained, ['alice']);
});

test('push API enforces session ownership and protects scheduled dispatch', async () => {
  const saved = [];
  const auth = Object.assign(async () => false, { getUser: async () => ({ id: 'user' }), isTrustedWrite: async () => true });
  const push = { config: () => ({ enabled: true, publicKey: 'public' }), authorized: (req) => req.headers.authorization === 'Bearer cron-secret', runCron: async () => ({ sent: 1 }) };
  const handle = createHandler({ auth, push, store: () => ({ pushSubscription: async (...args) => { saved.push(args); return { subscribed: true }; } }) });
  const request = async (url, method, body, headers = {}) => {
    let status; let result;
    await handle({ url, method, body, headers }, { writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } });
    return { status, result };
  };
  assert.equal((await request('/api/push/cron', 'GET')).status, 401);
  assert.equal((await request('/api/push/cron', 'GET', undefined, { authorization: 'Bearer cron-secret' })).result.sent, 1);
  assert.equal((await request('/api/push/subscription', 'POST', { action: 'get', subscription: { endpoint: 'https://web.push.apple.com/one' } }, { 'x-aimers-user': 'wrong' })).status, 401);
  assert.equal((await request('/api/push/subscription', 'POST', { action: 'get', subscription: { endpoint: 'https://web.push.apple.com/one' } }, { 'x-aimers-user': 'user' })).status, 200);
  assert.equal(saved[0][0], 'user');
});

test('subscription validation rejects arbitrary network targets and invalid keys', () => {
  for (const endpoint of ['http://web.push.apple.com/x', 'https://127.0.0.1/x', 'https://web.push.apple.com.attacker.com/x', 'https://web.push.apple.com@localhost/x', 'https://fcm.googleapis.com:8443/x']) {
    assert.throws(() => validateSubscription('get', { endpoint }), { status: 400 });
  }
  assert.equal(validateSubscription('get', { endpoint: 'https://updates.push.services.mozilla.com/x' }).endpoint.includes('mozilla'), true);
  assert.throws(() => validateSubscription('save', { endpoint: 'https://web.push.apple.com/x', keys: {} }), { status: 400 });
});

test('dispatcher waits for delivery and records success, expiry and retry without exposing endpoints', async () => {
  const finished = [];
  let claimed = false;
  const env = { SUPABASE_URL: 'url', SUPABASE_SECRET_KEY: 'secret', VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: 'https://example.com' };
  const jobs = [1, 2, 3].map((n) => ({ id: `${n}`, lease: 'lease', subscription: { endpoint: `https://web.push.apple.com/${n}` }, payload: { title: 'AIMers', url: '/#/groups' } }));
  const service = createPushService({ env, clientFactory: () => ({ rpc: async (name, args) => {
    if (name === 'app_claim_push') { const data = claimed ? [] : jobs; claimed = true; return { data }; }
    if (name === 'app_finish_push') finished.push(args);
    return { data: null };
  } }), send: async (subscription, payload, options) => {
    assert.equal(options.TTL, 43200); assert.equal(JSON.parse(payload).title, 'AIMers');
    if (subscription.endpoint.endsWith('/2')) throw Object.assign(new Error('expired'), { statusCode: 410 });
    if (subscription.endpoint.endsWith('/3')) throw Object.assign(new Error('unavailable'), { statusCode: 503 });
  } });
  assert.deepEqual(await service.drain(), { sent: 1, failed: 1, expired: 1 });
  assert.deepEqual(finished.map((row) => row.p_status).sort(), ['gone', 'retry', 'sent']);
});
