import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAuth, loadGoogleConfig } from './auth.js';
import { Store } from './db.js';

async function fixture(t, { secure = false, enabled = true } = {}) {
  const db = new Store(':memory:');
  t.after(() => db.close());
  let clock = Date.now();
  let nonce;
  let verificationError = false;
  let wrongNonce = false;
  let unverifiedEmail = false;
  let tokenCalls = 0;
  const client = {
    async generateCodeVerifierAsync() { return { codeVerifier: 'test-verifier', codeChallenge: 'test-challenge' }; },
    generateAuthUrl(options) {
      nonce = options.nonce;
      assert.equal(options.code_challenge_method, 'S256');
      assert.deepEqual(options.scope, ['openid', 'email', 'profile']);
      return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ state: options.state })}`;
    },
    async getToken(options) {
      tokenCalls++;
      assert.equal(options.code, 'test-code');
      assert.equal(options.codeVerifier, 'test-verifier');
      assert.equal(options.redirect_uri, `${origin}/auth/google/callback`);
      return { tokens: { id_token: 'mock-id-token', access_token: 'must-not-leak' } };
    },
    async verifyIdToken(options) {
      assert.deepEqual(options, { idToken: 'mock-id-token', audience: 'test-client' });
      if (verificationError) throw new Error('private verification details');
      return { getPayload: () => ({ sub: 'user-123', name: '테스트 사용자', email: 'test@example.com', email_verified: !unverifiedEmail, nonce: wrongNonce ? 'bad' : nonce }) };
    },
  };
  let origin;
  const auth = createAuth({
    getConfig: async () => ({ clientId: enabled ? 'test-client' : '', clientSecret: 'test-secret', origin }),
    clientFactory: () => client,
    now: () => clock,
    store: () => db,
  });
  const server = http.createServer(async (req, res) => {
    if (!await auth(req, res, new URL(req.url, 'http://localhost'))) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  origin = secure ? 'https://example.com' : base;
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const request = (pathname, options = {}) => fetch(base + pathname, { redirect: 'manual', ...options });
  async function start() {
    const res = await request('/auth/google');
    assert.equal(res.status, 302);
    const state = new URL(res.headers.get('location')).searchParams.get('state');
    return { state, cookie: `aimers_oauth=${state}`, res };
  }
  async function login() {
    const { state, cookie } = await start();
    const res = await request(`/auth/google/callback?code=test-code&state=${state}`, { headers: { cookie } });
    assert.equal(res.headers.get('location'), '/?auth=success#/profile');
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('aimers_session='));
    return { cookie: setCookie.split(';')[0], res };
  }
  return { request, start, login, origin, client,
    advance: (ms) => { clock += ms; },
    failVerification: () => { verificationError = true; },
    wrongNonce: () => { wrongNonce = true; },
    unverifiedEmail: () => { unverifiedEmail = true; },
    tokenCalls: () => tokenCalls,
  };
}

test('Google auth: verified identity, opaque session cookie, logout and CSRF protection', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await (await f.request('/api/auth/session')).json(), { enabled: true, user: null });
  const { cookie, res } = await f.login();
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('aimers_session='));
  assert.match(setCookie, /HttpOnly; SameSite=Lax; Max-Age=604800/);
  assert.doesNotMatch(setCookie, /test@example|test-secret|mock-id-token|must-not-leak/);
  const session = await (await f.request('/api/auth/session', { headers: { cookie } })).json();
  assert.notEqual(session.user.id, 'user-123');
  assert.deepEqual(session.user, { id: session.user.id, googleSub: 'user-123', name: '테스트 사용자', email: 'test@example.com' });
  assert.equal((await f.request('/api/auth/logout', { method: 'POST', headers: { cookie, origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await f.request('/api/auth/logout', { headers: { cookie } })).status, 405);
  assert.equal((await f.request('/api/auth/logout', { method: 'POST', headers: { cookie, origin: f.origin, 'x-requested-with': 'AIMers', 'x-aimers-user': session.user.id } })).status, 200);
  assert.equal((await (await f.request('/api/auth/session', { headers: { cookie } })).json()).user, null);
});

test('Google auth: rejects missing browser cookie, incorrect state, expiration and replay', async (t) => {
  const f = await fixture(t);
  const { state, cookie } = await f.start();
  const callback = `/auth/google/callback?code=test-code&state=${state}`;
  assert.match((await f.request(callback)).headers.get('location'), /invalid_state/);
  assert.match((await f.request(callback, { headers: { cookie: 'aimers_oauth=wrong' } })).headers.get('location'), /invalid_state/);
  assert.equal(f.tokenCalls(), 0);
  const success = await f.request(callback, { headers: { cookie } });
  assert.match(success.headers.get('location'), /auth=success/);
  assert.match((await f.request(callback, { headers: { cookie } })).headers.get('location'), /invalid_state/);
  const next = await f.start();
  f.advance(10 * 60 * 1000 + 1);
  assert.match((await f.request(`/auth/google/callback?code=test-code&state=${next.state}`, { headers: { cookie: next.cookie } })).headers.get('location'), /invalid_state/);
});

test('Google auth: consent cancellation and missing code do not authenticate', async (t) => {
  const f = await fixture(t);
  for (const query of ['error=access_denied', '']) {
    const { state, cookie } = await f.start();
    const res = await f.request(`/auth/google/callback?state=${state}&${query}`, { headers: { cookie } });
    assert.match(res.headers.get('location'), query ? /cancelled/ : /failed/);
    assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith('aimers_session=')));
  }
  assert.equal(f.tokenCalls(), 0);
});

test('Google auth: rejects invalid token, nonce and unverified email without leaking errors', async (t) => {
  for (const mode of ['failVerification', 'wrongNonce', 'unverifiedEmail']) {
    await t.test(mode, async (t) => {
      const f = await fixture(t);
      const { state, cookie } = await f.start();
      f[mode]();
      const res = await f.request(`/auth/google/callback?code=test-code&state=${state}`, { headers: { cookie } });
      assert.equal(res.headers.get('location'), '/?auth_error=failed#/profile');
      assert.equal((await (await f.request('/api/auth/session')).json()).user, null);
    });
  }
});

test('Google auth: secure deployment cookies and session expiry', async (t) => {
  const f = await fixture(t, { secure: true });
  const { cookie, res } = await f.login();
  for (const value of res.headers.getSetCookie()) assert.match(value, /; Secure/);
  f.advance(7 * 24 * 60 * 60 * 1000 + 1);
  assert.equal((await (await f.request('/api/auth/session', { headers: { cookie } })).json()).user, null);
});

test('Google auth: unavailable credentials keep demo usable', async (t) => {
  const f = await fixture(t, { enabled: false });
  assert.deepEqual(await (await f.request('/api/auth/session')).json(), { enabled: false, user: null });
  assert.match((await f.request('/auth/google')).headers.get('location'), /unavailable/);
});

test('Google config: explicit credentials, fixed callback origin and unsafe URL rejection', async () => {
  const env = { GOOGLE_CLIENT_ID: 'test-id', GOOGLE_CLIENT_SECRET: 'test-secret', APP_URL: 'https://example.com' };
  assert.deepEqual(await loadGoogleConfig(env), { clientId: 'test-id', clientSecret: 'test-secret', origin: 'https://example.com' });
  for (const APP_URL of ['http://example.com', 'https://example.com/path', 'https://user:pass@example.com', 'https://example.com?query=1']) {
    await assert.rejects(() => loadGoogleConfig({ ...env, APP_URL }));
  }
});
