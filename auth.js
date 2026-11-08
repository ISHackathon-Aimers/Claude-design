import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OAuth2Client } from 'google-auth-library';
import { getStore } from './db.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FLOW_TTL = 10 * 60 * 1000;
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const opaque = () => randomBytes(32).toString('base64url');

export async function loadGoogleConfig(env = process.env) {
  let credentials = {};
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    const files = await readdir(ROOT);
    const file = env.GOOGLE_CLIENT_SECRET_FILE || files.find((name) => /^client_secret.*\.json$/.test(name));
    if (file) {
      const json = JSON.parse(await readFile(path.resolve(ROOT, file), 'utf8'));
      if (!json.web) throw new Error('Google credentials must use a Web application client.');
      credentials = json.web;
    }
  }
  const origin = new URL(env.APP_URL || `http://localhost:${Number(env.PORT) || 3000}`);
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) {
    throw new Error('APP_URL must be an HTTPS origin, or HTTP localhost.');
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID || credentials.client_id,
    clientSecret: env.GOOGLE_CLIENT_SECRET || credentials.client_secret,
    origin: origin.origin,
  };
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((part) => {
    const i = part.indexOf('=');
    return i < 0 ? [] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  }).filter((part) => part.length === 2));
}

export function createAuth({ getConfig = loadGoogleConfig, clientFactory, now = Date.now, store = getStore } = {}) {
  let setup;
  async function config() {
    setup ||= Promise.resolve().then(getConfig).then((c) => ({
      ...c,
      redirectUri: `${c.origin}/auth/google/callback`,
      client: c.clientId && c.clientSecret
        ? (clientFactory ? clientFactory(c) : new OAuth2Client(c.clientId, c.clientSecret, `${c.origin}/auth/google/callback`))
        : null,
    })).catch(() => ({ client: null, origin: 'http://localhost:3000' }));
    return setup;
  }
  function cookie(c, name, value, seconds) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${c.origin.startsWith('https:') ? '; Secure' : ''}`;
  }
  function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  }
  function redirect(res, location, setCookies = []) {
    res.writeHead(302, { location, 'set-cookie': setCookies, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    res.end();
  }
  const auth = async function (req, res, url) {
    const routes = ['/auth/google', '/auth/google/callback', '/api/auth/session', '/api/auth/logout'];
    if (!routes.includes(url.pathname)) return false;
    const c = await config();
    const db = store();
    db.prune(now());
    const jar = cookies(req);
    const user = db.getSession(jar.aimers_session, now());
    const expectedMethod = url.pathname === '/api/auth/logout' ? 'POST' : 'GET';
    if (req.method !== expectedMethod) {
      res.setHeader('allow', expectedMethod);
      json(res, 405, { error: '허용되지 않는 요청입니다.' });
      return true;
    }
    if (url.pathname === '/api/auth/session') {
      json(res, 200, { enabled: Boolean(c.client), user: user || null });
      return true;
    }
    if (url.pathname === '/api/auth/logout') {
      if (req.headers.origin !== c.origin || req.headers['x-requested-with'] !== 'AIMers') {
        json(res, 403, { error: '요청 출처를 확인할 수 없습니다.' });
        return true;
      }
      if (user && req.headers['x-aimers-user'] !== user.id) {
        json(res, 401, { error: '로그인 계정이 변경되었습니다. 페이지를 다시 열어 주세요.' });
        return true;
      }
      db.deleteSession(jar.aimers_session);
      res.setHeader('set-cookie', cookie(c, 'aimers_session', '', 0));
      json(res, 200, { ok: true });
      return true;
    }
    if (!c.client) {
      redirect(res, '/?auth_error=unavailable#/profile');
      return true;
    }
    if (url.pathname === '/auth/google') {
      if (db.countFlows() >= 1000) {
        json(res, 429, { error: '잠시 후 다시 로그인해 주세요.' });
        return true;
      }
      const state = opaque();
      const nonce = opaque();
      const { codeVerifier, codeChallenge } = await c.client.generateCodeVerifierAsync();
      db.deleteFlow(jar.aimers_oauth);
      db.setFlow(state, { nonce, codeVerifier, expires: now() + FLOW_TTL });
      redirect(res, c.client.generateAuthUrl({
        scope: ['openid', 'email', 'profile'], state, nonce, prompt: 'select_account',
        code_challenge: codeChallenge, code_challenge_method: 'S256',
      }), [cookie(c, 'aimers_oauth', state, FLOW_TTL / 1000)]);
      return true;
    }
    const state = url.searchParams.get('state');
    const flow = db.getFlow(state);
    const clearFlow = cookie(c, 'aimers_oauth', '', 0);
    if (!state || state !== jar.aimers_oauth || !flow) {
      redirect(res, '/?auth_error=invalid_state#/profile', [clearFlow]);
      return true;
    }
    db.deleteFlow(state);
    if (url.searchParams.has('error')) {
      redirect(res, '/?auth_error=cancelled#/profile', [clearFlow]);
      return true;
    }
    try {
      const code = url.searchParams.get('code');
      if (!code) throw new Error('Missing authorization code');
      const { tokens } = await c.client.getToken({ code, codeVerifier: flow.codeVerifier, redirect_uri: c.redirectUri });
      if (!tokens.id_token) throw new Error('Missing ID token');
      const ticket = await c.client.verifyIdToken({ idToken: tokens.id_token, audience: c.clientId });
      const payload = ticket.getPayload();
      if (!payload?.sub || payload.nonce !== flow.nonce || payload.email_verified !== true || !payload.email) {
        throw new Error('Invalid Google identity');
      }
      if (db.countSessions() >= 10000) throw new Error('Session capacity reached');
      const id = opaque();
      const user = db.upsertUser({ id: payload.sub, email: payload.email, name: payload.name || payload.email.split('@')[0] }, now());
      db.transaction(() => {
        db.deleteSession(jar.aimers_session);
        db.setSession(id, user.id, now() + SESSION_TTL);
      });
      redirect(res, '/?auth=success#/profile', [clearFlow, cookie(c, 'aimers_session', id, SESSION_TTL / 1000)]);
    } catch {
      redirect(res, '/?auth_error=failed#/profile', [clearFlow]);
    }
    return true;
  };
  auth.getUser = (req) => store().getSession(cookies(req).aimers_session, now());
  auth.isTrustedWrite = async (req) => req.headers.origin === (await config()).origin && req.headers['x-requested-with'] === 'AIMers';
  return auth;
}

export const handleAuth = createAuth();
