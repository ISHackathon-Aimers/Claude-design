import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runTask, isDemo } from './ai.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_BODY = 200_000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('요청이 너무 큽니다.'), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('요청 형식이 올바르지 않습니다.'), { status: 400 });
  }
}

export async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/ai') {
      if (req.method !== 'POST') return send(res, 405, { error: '허용되지 않는 요청입니다.' });
      const body = await readJson(req).catch((e) => e);
      if (body instanceof Error) return send(res, body.status, { error: body.message });
      const result = await runTask(body?.task, body?.input);
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
    console.error(e);
    send(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  http.createServer(handle).listen(port, () => {
    const lan = Object.values(os.networkInterfaces()).flat().find((n) => n?.family === 'IPv4' && !n.internal)?.address;
    console.log(`AIMers 실행 중: http://localhost:${port}${lan ? `  (같은 와이파이의 휴대폰: http://${lan}:${port})` : ''}`);
    console.log(isDemo() ? '시연 모드: ANTHROPIC_API_KEY가 없어 미리 준비한 답변을 사용합니다.' : 'AI 모드: Claude API에 연결합니다.');
  });
}
