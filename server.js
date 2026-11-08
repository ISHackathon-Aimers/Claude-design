import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runTask, isDemo } from './ai.js';
import { handleAuth, publicConfig } from './auth.js';
import { getStore } from './supabase-db.js';
import { pushService, validateSubscription } from './push.js';
import { PREMIUM_TASKS, hasPremium } from './public/plans.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_BODY = 3_500_000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  if (req.body !== undefined) {
    const raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > MAX_BODY) throw Object.assign(new Error('요청이 너무 큽니다.'), { status: 413 });
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
      return value;
    } catch { throw Object.assign(new Error('요청 형식이 올바르지 않습니다.'), { status: 400 }); }
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('요청이 너무 큽니다.'), { status: 413 });
    chunks.push(c);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
    return value;
  } catch {
    throw Object.assign(new Error('요청 형식이 올바르지 않습니다.'), { status: 400 });
  }
}

export function createHandler({ auth = handleAuth, store = getStore, aiTask = runTask, push = pushService } = {}) {
return async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/push/config') {
      if (req.method !== 'GET') return send(res, 405, { error: '허용되지 않는 요청입니다.' });
      return send(res, 200, push.config());
    }
    if (url.pathname === '/api/push/cron') {
      if (req.method !== 'GET') return send(res, 405, { error: '허용되지 않는 요청입니다.' });
      if (!push.authorized(req)) return send(res, 401, { error: '인증되지 않은 예약 작업입니다.' });
      return send(res, 200, await push.runCron());
    }
    if (url.pathname === '/api/config') {
      if (req.method !== 'GET') return send(res, 405, { error: '허용되지 않는 요청입니다.' });
      return send(res, 200, publicConfig());
    }
    if (await auth(req, res, url)) return;
    let requestUser;
    let requestStore;
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/status') {
      const user = await auth.getUser(req);
      requestUser = user;
      if (!user) return send(res, 401, { error: '로그인해 주세요.' });
      if (req.headers['x-aimers-user'] !== user.id) return send(res, 401, { error: '로그인 계정이 변경되었습니다. 페이지를 다시 열어 주세요.' });
      if (!['GET', 'HEAD'].includes(req.method) && !await auth.isTrustedWrite(req)) return send(res, 403, { error: '요청 출처를 확인할 수 없습니다.' });
      const db = requestStore = store(req, user);
      if (url.pathname === '/api/membership') {
        if (req.method !== 'GET') return send(res, 405, { error: '허용되지 않는 요청입니다.' });
        return send(res, 200, await db.membership(user.id));
      }
      if (url.pathname === '/api/membership/cancel') {
        if (req.method !== 'POST') return send(res, 405, { error: '허용되지 않는 요청입니다.' });
        return send(res, 200, await db.cancelMembership(user.id));
      }
      if (url.pathname === '/api/push/subscription') {
        if (req.method !== 'POST') return send(res, 405, { error: '허용되지 않는 요청입니다.' });
        const body = await readJson(req);
        const subscription = validateSubscription(body.action, body.subscription);
        if (body.action === 'save' && !push.config().enabled) return send(res, 503, { error: '알림 서버 설정이 아직 완료되지 않았어요.' });
        return send(res, 200, await db.pushSubscription(user.id, body.action, subscription));
      }
      if (url.pathname === '/api/state') {
        if (req.method === 'GET') return send(res, 200, await db.state(user.id));
        if (req.method !== 'PUT') return send(res, 405, { error: '허용되지 않는 요청입니다.' });
        const body = await readJson(req);
        return send(res, 200, await db.saveState(user.id, body.state, body.revision));
      }
      if (url.pathname === '/api/ai/history' && req.method === 'GET') return send(res, 200, { runs: await db.aiHistory(user.id) });
      if (url.pathname === '/api/groups' && req.method === 'POST') {
        const body = await readJson(req);
        return send(res, 201, await db.createGroup(user.id, body.name));
      }
      if (url.pathname === '/api/groups/join' && req.method === 'POST') {
        const body = await readJson(req);
        return send(res, 200, await db.joinGroup(user.id, body.code));
      }
      const group = url.pathname.match(/^\/api\/groups\/([a-zA-Z0-9_-]+)(\/pokes)?$/);
      if (group) {
        if (!group[2] && req.method === 'DELETE') return send(res, 200, await db.leaveGroup(user.id, group[1]));
        if (group[2] && req.method === 'POST') {
          const body = await readJson(req);
          const result = await db.poke(user.id, group[1], body.recipientId);
          // The DB trigger has already persisted the delivery jobs, so a push outage must not lose the poke.
          if (push.config().enabled) {
            try { await push.drain(user.id); } catch { console.error('Push delivery deferred to the next scheduled run.'); }
          }
          return send(res, 200, result);
        }
        return send(res, 405, { error: '허용되지 않는 요청입니다.' });
      }
      if (url.pathname === '/api/notifications/read' && req.method === 'POST') return send(res, 200, await db.readNotifications(user.id));
      if (url.pathname !== '/api/ai') return send(res, 404, { error: '요청한 기능을 찾을 수 없습니다.' });
    }
    if (url.pathname === '/api/ai') {
      if (req.method !== 'POST') return send(res, 405, { error: '허용되지 않는 요청입니다.' });
      const body = await readJson(req).catch((e) => e);
      if (body instanceof Error) return send(res, body.status, { error: body.message });
      if (Buffer.byteLength(JSON.stringify(body)) > 200_000) return send(res, 413, { error: 'AI 요청이 너무 큽니다.' });
      if (PREMIUM_TASKS.has(body.task) && !hasPremium(await requestStore.membership(requestUser.id))) {
        return send(res, 403, { code: 'PREMIUM_REQUIRED', error: 'AIMers+는 프리미엄 요금제에서 이용할 수 있어요.' });
      }
      const result = await aiTask(body?.task, body?.input);
      if (!result.error) await requestStore.saveAiRun(requestUser.id, body.task, body.input, result);
      return send(res, result.error ? 400 : 200, result);
    }
    if (url.pathname === '/api/status') return send(res, 200, { demo: isDemo() });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: '허용되지 않는 요청입니다.' });

    let rel;
    try {
      rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    } catch {
      return send(res, 400, 'Bad request', 'text/plain');
    }
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    const data = await readFile(file).catch(() => null);
    if (!data) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    if (e.status) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
}
}

export const handle = createHandler();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  http.createServer(handle).listen(port, () => {
    const lan = Object.values(os.networkInterfaces()).flat().find((n) => n?.family === 'IPv4' && !n.internal)?.address;
    console.log(`AIMers 실행 중: http://localhost:${port}${lan ? `  (같은 와이파이의 휴대폰: http://${lan}:${port})` : ''}`);
    console.log(isDemo() ? '시연 모드: DEEPSEEK_API_KEY가 없어 미리 준비한 답변을 사용합니다.' : 'AI 모드: DeepSeek API에 연결합니다.');
  });
}
