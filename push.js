import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const unavailable = () => Object.assign(new Error('알림 서버 설정이 아직 완료되지 않았어요.'), { status: 503 });
export function pushConfig(env = process.env) {
  const enabled = Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
  return { enabled, publicKey: enabled ? env.VAPID_PUBLIC_KEY : '' };
}
export function cronAuthorized(req, env = process.env) {
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 16) return false;
  const actual = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function validateSubscription(action, value) {
  if (!['save', 'delete', 'get'].includes(action) || !value || typeof value.endpoint !== 'string' || value.endpoint.length > 2000) {
    throw Object.assign(new Error('알림 구독 형식이 올바르지 않습니다.'), { status: 400 });
  }
  let url;
  try { url = new URL(value.endpoint); } catch { /* Handled below. */ }
  const hosts = ['push.apple.com', 'push.services.mozilla.com', 'notify.windows.com', 'fcm.googleapis.com'];
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
    !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw Object.assign(new Error('지원하는 브라우저의 알림 구독을 사용해 주세요.'), { status: 400 });
  }
  if (action === 'save' && (!/^[A-Za-z0-9_-]{87}={0,2}$/.test(value.keys?.p256dh || '') ||
    !/^[A-Za-z0-9_-]{22}={0,2}$/.test(value.keys?.auth || '') || typeof value.pokes !== 'boolean')) {
    throw Object.assign(new Error('알림 구독 키가 올바르지 않습니다.'), { status: 400 });
  }
  return { endpoint: value.endpoint, ...(action === 'save' ? { keys: { p256dh: value.keys.p256dh, auth: value.keys.auth }, pokes: value.pokes } : {}) };
}

export function createPushService({ env = process.env, clientFactory = createClient, send = webpush.sendNotification, now = Date.now } = {}) {
  const config = () => pushConfig(env);
  const rpc = async (name, args = {}) => {
    if (!config().enabled) throw unavailable();
    const client = clientFactory(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(`Push DB operation failed: ${name}`);
    return data;
  };
  return {
    config,
    authorized: (req) => cronAuthorized(req, env),
    async drain(actor = null) {
      if (!config().enabled) return { sent: 0, failed: 0, expired: 0 };
      const metrics = { sent: 0, failed: 0, expired: 0 };
      const started = now();
      for (let count = 0; count < 200 && now() - started < 50_000; count += 10) {
        const jobs = await rpc('app_claim_push', { p_actor: actor, p_limit: 10 });
        if (!jobs.length) break;
        // Bound concurrent sockets and wait for every delivery before ending the function.
        for (let offset = 0; offset < jobs.length; offset += 5) {
          await Promise.all(jobs.slice(offset, offset + 5).map(async (job) => {
            let status = 'sent';
            try {
              validateSubscription('get', job.subscription);
              await send(job.subscription, JSON.stringify(job.payload), {
                vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
                TTL: 43_200, timeout: 10_000, urgency: 'normal',
              });
              metrics.sent++;
            } catch (error) {
              status = [404, 410].includes(error.statusCode) || error.status === 400 ? 'gone' : 'retry';
              if (status === 'gone') metrics.expired++; else metrics.failed++;
            }
            await rpc('app_finish_push', { p_id: job.id, p_lease: job.lease, p_status: status });
          }));
        }
      }
      return metrics;
    },
    async runCron() {
      await rpc('app_enqueue_reminders');
      return this.drain();
    },
  };
}
export const pushService = createPushService();
