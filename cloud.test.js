import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, handle } from './server.js';

async function request(handler, body, headers = {}) {
  let status;
  let result;
  await handler({ url: '/api/ai', method: 'POST', body, headers }, {
    writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); },
  });
  return { status, result };
}

test('Vercel parsed bodies preserve main authentication, validation and AI history', async () => {
  const previous = process.env.AIMERS_DEMO;
  process.env.AIMERS_DEMO = '1';
  const saved = [];
  const auth = Object.assign(async () => false, { getUser: async () => ({ id: 'user' }), isTrustedWrite: async () => true });
  const handler = createHandler({ auth, store: () => ({ saveAiRun: async (...args) => saved.push(args) }) });
  try {
    const headers = { 'x-aimers-user': 'user' };
    assert.equal((await request(handler, { task: 'followup', input: { raw: '동아리 활동' } }, headers)).status, 200);
    assert.equal(saved.length, 1);
    assert.equal(saved[0][0], 'user');
    assert.equal((await request(handler, '{broken', headers)).status, 400);
    assert.equal((await request(handler, null, headers)).status, 400);
    assert.equal((await request(handler, { raw: 'x'.repeat(210000) }, headers)).status, 413);
    assert.equal((await request(handle, {})).status, 401);
    assert.equal((await request(handler, {}, { 'x-aimers-user': 'someone-else' })).status, 401);
  } finally {
    if (previous === undefined) delete process.env.AIMERS_DEMO; else process.env.AIMERS_DEMO = previous;
  }
});
