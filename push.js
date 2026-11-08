import { createClient } from '@supabase/supabase-js';
import { sendNotification } from 'web-push';
import { timingSafeEqual } from 'node:crypto';

export function pushConfig(env = process.env) {
  const enabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_URL && env.CRON_SECRET);
  return { enabled, publicKey: enabled ? env.VAPID_PUBLIC_KEY : null };
}

export function validCron(req, env = process.env) {
  if (!env.CRON_SECRET) return false;
  const received = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// Subscriptions are sent only to known browser push services, never arbitrary URLs.
export function validateSubscription(value) {
  let url;
  try { url = new URL(value?.endpoint); } catch { url = null; }
  const host = url?.hostname || '';
  const allowed = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com'
    || host === 'web.push.apple.com' || host.endsWith('.push.apple.com')
    || host === 'notify.windows.com' || host.endsWith('.notify.windows.com');
  if (!url || url.protocol !== 'https:' || url.port || url.username || url.password || !allowed
    || value.endpoint.length > 2048 || !/^[\w-]{87}=?$/.test(value.keys?.p256dh || '')
    || !/^[\w-]{22}={0,2}$/.test(value.keys?.auth || '')) {
    throw Object.assign(new Error('알림 구독 정보가 올바르지 않습니다.'), { status: 400 });
  }
  return { endpoint: value.endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}

export function pushAdmin(env = process.env) {
  if (!pushConfig(env).enabled) throw Object.assign(new Error('서버의 푸시 알림 설정이 아직 완료되지 않았어요.'), { status: 503 });
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function deliverPush(client, subscription, payload, { env = process.env, send = sendNotification } = {}) {
  try {
    validateSubscription(subscription);
    await send(subscription, JSON.stringify(payload), {
      TTL: 3600, urgency: 'normal', timeout: 10000,
      vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
    });
    return true;
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410 || error.status === 400) {
      const { error: cleanupError } = await client.from('app_push_subscriptions').delete().eq('endpoint', subscription.endpoint);
      if (cleanupError) throw cleanupError;
      return true;
    }
    // Do not log subscription endpoints or encryption keys.
    return false;
  }
}

export async function dispatchPush({ sender = null, daily = false, client = pushAdmin(), deliver = deliverPush } = {}) {
  if (daily) {
    const { error } = await client.rpc('app_enqueue_daily_push');
    if (error) throw error;
  }
  let sent = 0;
  // Bound work to fit the serverless request budget. Pending rows stay in the queue.
  for (let batch = 0; batch < 5; batch++) {
    const { data: jobs, error } = await client.rpc('app_claim_push_jobs', { p_sender: sender, p_limit: 20 });
    if (error) throw error;
    if (!jobs.length) break;
    await Promise.all(jobs.map(async (job) => {
      const { data: subscriptions, error } = await client.from('app_push_subscriptions').select('subscription').eq('user_id', job.user_id);
      if (error) throw error;
      const results = await Promise.all(subscriptions.map(({ subscription }) => deliver(client, subscription, job.payload)));
      if (results.every(Boolean)) {
        const { error } = await client.from('app_push_jobs').update({ sent_at: new Date().toISOString() }).eq('id', job.id);
        if (error) throw error;
        sent++;
      }
    }));
  }
  return { sent };
}
