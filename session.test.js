import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createClient } from '@supabase/supabase-js';
import { createPersistentStorage } from './public/auth-storage.js';
import { createSessionManager } from './public/session.js';

const localStore = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};
const blockedStorage = (indexedDB) => ({ get localStorage() { throw new Error('blocked'); }, indexedDB });

for (const mode of ['localStorage', 'IndexedDB']) {
  test(`Supabase session survives reopening, refreshes expired tokens and clears on logout using ${mode}`, async () => {
    const host = mode === 'localStorage' ? { localStorage: localStore() } : blockedStorage(new IDBFactory());
    const key = `session-test-${mode}`;
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'user@example.com', user_metadata: { full_name: 'User' }, app_metadata: {} };
    let refreshes = 0;
    const jwt = () => `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) })).toString('base64url')}.testsignature`;
    const authFetch = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/logout')) return new Response(null, { status: 204 });
      if (url.searchParams.get('grant_type') === 'refresh_token') refreshes++;
      return Response.json({ access_token: jwt(), refresh_token: `refresh-${refreshes}`, token_type: 'bearer', expires_in: 3600, user });
    };
    const connect = async () => createClient('https://example.supabase.co', 'sb_publishable_test', {
      global: { fetch: authFetch }, auth: { storageKey: key, storage: await createPersistentStorage(host), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const first = await connect();
    assert.equal((await first.auth.signInWithPassword({ email: user.email, password: 'test-only-password' })).error, null);
    const reopened = createSessionManager({ connect });
    assert.equal((await reopened.initialize()).user.id, user.id);
    const storage = await createPersistentStorage(host);
    const stored = JSON.parse(await storage.getItem(key));
    stored.expires_at = Math.floor(Date.now() / 1000) - 60;
    await storage.setItem(key, JSON.stringify(stored));
    assert.equal((await reopened.current()).user.id, user.id);
    assert.equal(refreshes, 1);
    assert.equal(JSON.parse(await storage.getItem(key)).refresh_token, 'refresh-1');
    await reopened.signOut();
    assert.equal(await storage.getItem(key), null);
    assert.equal((await createSessionManager({ connect }).initialize()).user, null);
  });
}

test('blocked browser stores fail explicitly instead of silently keeping a memory-only login', async () => {
  await assert.rejects(createPersistentStorage(blockedStorage(undefined)), /저장할 수 없어요/);
});

function managerFixture({ refreshError, changeAccount = false, always401 = false } = {}) {
  let session = { access_token: 'old', refresh_token: 'refresh', user: { id: 'user', email: 'user@example.com' } };
  let refreshes = 0;
  const requests = [];
  const client = { auth: {
    getSession: async () => ({ data: { session }, error: null }),
    refreshSession: async () => {
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (refreshError) return { data: { session: null }, error: refreshError };
      session = { ...session, access_token: 'new', user: { ...session.user, id: changeAccount ? 'other' : 'user' } };
      return { data: { session }, error: null };
    },
  } };
  const manager = createSessionManager({ connect: async () => client, fetcher: async (_url, options) => {
    requests.push(options);
    return Response.json({}, { status: always401 || options.headers.authorization === 'Bearer old' ? 401 : 200 });
  } });
  return { manager, requests, get refreshes() { return refreshes; } };
}

test('401 retries use one refresh for concurrent requests and replay the original JSON body', async () => {
  const f = managerFixture(); await f.manager.initialize();
  const options = { method: 'PUT', headers: { 'x-aimers-user': 'user' }, body: '{"revision":7}' };
  const results = await Promise.all([f.manager.request('/api/state', options), f.manager.request('/api/state', options)]);
  assert.ok(results.every((response) => response.status === 200));
  assert.equal(f.refreshes, 1);
  assert.ok(f.requests.every((request) => request.body === options.body));
});
test('requests stop after one failed retry and never replay data under a different account', async () => {
  let f = managerFixture({ always401: true }); await f.manager.initialize();
  assert.equal((await f.manager.request('/api/state', { headers: { 'x-aimers-user': 'user' } })).status, 401);
  assert.equal(f.requests.length, 2);
  f = managerFixture({ changeAccount: true }); await f.manager.initialize();
  await assert.rejects(f.manager.request('/api/state', { headers: { 'x-aimers-user': 'user' } }), { status: 401 });
  assert.equal(f.requests.length, 1);
});
test('temporary refresh failures keep the existing session and return a connection error', async () => {
  const f = managerFixture({ refreshError: { name: 'AuthRetryableFetchError', status: 503 } });
  await f.manager.initialize();
  await assert.rejects(f.manager.request('/api/state', { headers: { 'x-aimers-user': 'user' } }), { status: 503 });
  assert.equal((await f.manager.current()).user.id, 'user');
  assert.equal(f.requests.length, 1);
});
