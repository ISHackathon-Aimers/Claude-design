import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicConfig, requireUser } from './auth.js';
import { StateSync } from './public/sync-state.js';
import { handle } from './server.js';

async function request(url, method = 'GET', body) {
  let status;
  let result;
  await handle({ url, method, body, headers: {} }, {
    writeHead(code) { status = code; },
    end(value) { result = JSON.parse(value); },
  });
  return { status, result };
}

test('Vercel parsed request bodies work and paid AI requires authentication', async () => {
  const original = { demo: process.env.AIMERS_DEMO, key: process.env.DEEPSEEK_API_KEY };
  try {
    process.env.AIMERS_DEMO = '1';
    assert.equal((await request('/api/ai', 'POST', { task: 'followup', input: { raw: '동아리 활동' } })).status, 200);
    assert.equal((await request('/api/ai', 'POST', '{broken')).status, 400);
    assert.equal((await request('/api/ai', 'POST', { raw: 'x'.repeat(210000) })).status, 413);
    process.env.AIMERS_DEMO = '0';
    process.env.DEEPSEEK_API_KEY = 'test-not-a-real-key';
    assert.equal((await request('/api/ai', 'POST', {})).status, 401);
  } finally {
    for (const [key, value] of [['AIMERS_DEMO', original.demo], ['DEEPSEEK_API_KEY', original.key]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('public configuration rejects service credentials and incomplete setup', () => {
  assert.deepEqual(publicConfig({}), { enabled: false });
  assert.throws(() => publicConfig({ SUPABASE_URL: 'https://example.supabase.co' }));
  for (const key of ['sb_secret_private', `e30.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.sig`]) {
    assert.throws(() => publicConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: key }));
  }
  const config = publicConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public', DEEPSEEK_API_KEY: 'secret' });
  assert.equal(config.enabled, true);
  assert.equal(JSON.stringify(config).includes('secret'), false);
});

test('AI authentication verifies the supplied token with Supabase', async () => {
  const config = { enabled: true, supabaseUrl: 'https://example.supabase.co', supabaseKey: 'sb_publishable_public' };
  await assert.rejects(requireUser({ headers: {} }, { config }), { status: 401 });
  const clientFactory = () => ({ auth: { getUser: async (token) => {
    assert.equal(token, 'access-token');
    return { data: { user: { id: 'verified-user' } }, error: null };
  } } });
  assert.equal((await requireUser({ headers: { authorization: 'Bearer access-token' } }, { config, clientFactory })).id, 'verified-user');
  await assert.rejects(requireUser({ headers: { authorization: 'Bearer invalid' } }, {
    config, clientFactory: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: {} }) } }),
  }), { status: 401 });
});

test('edits made during a save are persisted next with the new revision', async () => {
  let release;
  const calls = [];
  const cache = [];
  const sync = new StateSync({ revision: 2, status: () => {}, cache: (value) => cache.push(value), write: async (state, revision) => {
    calls.push([state, revision]);
    if (calls.length === 1) await new Promise((resolve) => { release = resolve; });
    return revision + 1;
  } });
  sync.queue({ entries: ['first'] });
  const saving = sync.flush();
  sync.queue({ entries: ['first', 'second'] });
  release();
  await saving;
  assert.deepEqual(calls, [[{ entries: ['first'] }, 2], [{ entries: ['first', 'second'] }, 3]]);
  assert.equal(sync.pending, null);
  assert.deepEqual(cache.at(-1), { state: { entries: ['first', 'second'] }, revision: 4, dirty: false });
  clearTimeout(sync.timer);
});

test('network failures retain recovery state and can be retried', async () => {
  let offline = true;
  let cache;
  const sync = new StateSync({ write: async () => { if (offline) throw new Error('offline'); return 1; }, cache: (value) => { cache = value; }, status: () => {} });
  sync.queue({ entries: ['unsaved'] });
  await assert.rejects(sync.flush(), /offline/);
  assert.equal(cache.dirty, true);
  assert.equal(sync.revision, 0);
  offline = false;
  await sync.flush();
  assert.equal(cache.dirty, false);
});

test('conflicting saves stop until the user resolves the difference', async () => {
  let calls = 0;
  const sync = new StateSync({ write: async () => { calls++; throw Object.assign(new Error('conflict'), { conflict: true }); }, cache: () => {}, status: () => {} });
  sync.queue({ entries: ['unsaved'] });
  await assert.rejects(sync.flush(), /conflict/);
  await assert.rejects(sync.flush());
  assert.equal(calls, 1);
  assert.ok(sync.pending);
});
