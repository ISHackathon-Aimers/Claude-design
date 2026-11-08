import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicConfig, requireUser, handleAuth } from './auth.js';

test('public config exposes only public Supabase credentials', () => {
  assert.deepEqual(publicConfig({}), { enabled: false });
  assert.throws(() => publicConfig({ SUPABASE_URL: 'https://example.supabase.co' }));
  for (const key of ['sb_secret_private', `e30.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.sig`]) {
    assert.throws(() => publicConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: key }));
  }
  const config = publicConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public', DEEPSEEK_API_KEY: 'secret' });
  assert.equal(config.enabled, true);
  assert.equal(JSON.stringify(config).includes('secret'), false);
  assert.throws(() => publicConfig({ SUPABASE_URL: 'http://example.com', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public' }));
});

test('authentication verifies access tokens with Supabase rather than trusting client identities', async () => {
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

test('temporary Supabase outages are 503 responses rather than false session expiration', async () => {
  await assert.rejects(requireUser({ headers: { authorization: 'Bearer valid-token' } }, {
    config: { enabled: true, supabaseUrl: 'https://example.supabase.co', supabaseKey: 'sb_publishable_public' },
    clientFactory: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 503 } }) } }),
  }), { status: 503 });
});

test('writes reject cross-origin browser requests', async () => {
  const headers = { host: 'app.example.com', origin: 'https://app.example.com', 'x-requested-with': 'AIMers' };
  assert.equal(await handleAuth.isTrustedWrite({ headers }), true);
  assert.equal(await handleAuth.isTrustedWrite({ headers: { ...headers, origin: 'https://attacker.example' } }), false);
  assert.equal(await handleAuth.isTrustedWrite({ headers: { ...headers, 'x-requested-with': '' } }), false);
});
