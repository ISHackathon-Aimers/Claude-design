import { createClient } from '@supabase/supabase-js';

export function publicConfig(env = process.env) {
  const url = env.SUPABASE_URL || '';
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
  if (!url && !key) return { enabled: false };
  if (!url || !key) throw new Error('Supabase URL and publishable key are required together.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('Invalid Supabase URL.');
  // Reject server secrets before exposing the public configuration.
  const legacyRole = key.split('.').length === 3 ? JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role : null;
  if (!key.startsWith('sb_publishable_') && legacyRole !== 'anon') throw new Error('Use a Supabase publishable or anon key.');
  return { enabled: true, supabaseUrl: parsed.origin, supabaseKey: key };
}

export async function requireUser(req, { config = publicConfig(), clientFactory = createClient } = {}) {
  const token = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '')?.[1];
  if (!config.enabled || !token) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 });
  const client = clientFactory(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error && (error.name === 'AuthRetryableFetchError' || error.status >= 500)) {
    throw Object.assign(new Error('로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'), { status: 503 });
  }
  if (error || !data.user) throw Object.assign(new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.'), { status: 401 });
  return data.user;
}

export function userClient(req) {
  const config = publicConfig();
  return createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.authorization } },
  });
}

export const handleAuth = Object.assign(async () => false, {
  getUser: requireUser,
  isTrustedWrite: async (req) => {
    if (req.headers['x-requested-with'] !== 'AIMers') return false;
    if (!req.headers.origin) return true;
    try { return new URL(req.headers.origin).host === req.headers.host; }
    catch { return false; }
  },
});
