import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from './db.js';
import { createHandler } from './server.js';
import { todayStr } from './public/logic.js';

const identity = (id, email = `${id}@example.com`) => ({ id, email, name: `User ${id}` });
const entry = (id = 'entry1') => ({ id, date: todayStr(), category: '프로젝트', title: 'Private diary',
  raw: 'Private original text', summary: 'Private summary', qa: [{ q: 'Question', a: 'Answer' }], tags: ['협업'] });
function fixture(t) {
  const db = new Store(':memory:');
  t.after(() => db.close());
  const a = db.upsertUser(identity('google-a'));
  const b = db.upsertUser(identity('google-b'));
  const c = db.upsertUser(identity('google-c'));
  return { db, a, b, c };
}

test('DB: stable Google subject identity, independent internal ID and mutable email', (t) => {
  const { db, a } = fixture(t);
  const changed = db.upsertUser({ ...identity('google-a', 'new@example.com'), name: 'New Google name' });
  assert.equal(changed.id, a.id);
  assert.equal(changed.googleSub, 'google-a');
  assert.equal(changed.email, 'new@example.com');
  const sameEmail = db.upsertUser(identity('different-sub', 'new@example.com'));
  assert.notEqual(sameEmail.id, a.id);
  assert.equal(db.state(a.id).state.profile.name, 'User google-a');
});

test('DB: round-trip profile, photo, categories, complete entries and notification settings', (t) => {
  const { db, a, b } = fixture(t);
  const initial = db.state(a.id);
  initial.state.profile = { ...initial.state.profile, name: '사용자', bio: '소개', photo: 'data:image/jpeg;base64,YQ==',
    public: true, periodDays: 14, notify: true, theme: 'dark', fontScale: 120 };
  initial.state.entries = [entry()];
  initial.state.categories.push('새 카테고리');
  initial.state.lastNotified = todayStr();
  assert.deepEqual(db.saveState(a.id, initial.state, initial.revision), { revision: 1 });
  const saved = db.state(a.id).state;
  assert.deepEqual(saved, initial.state);
  assert.equal(db.state(b.id).state.entries.length, 0);
});

test('DB: stale writes and malformed input cannot partially replace valid data', (t) => {
  const { db, a } = fixture(t);
  const first = db.state(a.id);
  first.state.entries.push(entry());
  db.saveState(a.id, first.state, first.revision);
  const before = db.state(a.id);
  assert.throws(() => db.saveState(a.id, { ...first.state, entries: [] }, 0), (e) => e.status === 409);
  for (const invalid of [
    { ...before.state, categories: [] },
    { ...before.state, profile: { ...before.state.profile, photo: '" onerror="alert(1)' } },
    { ...before.state, entries: [{ ...entry(), category: 'missing' }] },
    { ...before.state, entries: [{ ...entry(), date: '2026-02-30' }] },
    { ...before.state, entries: [entry(), entry()] },
  ]) assert.throws(() => db.saveState(a.id, invalid, before.revision), (e) => e.status === 400);
  assert.deepEqual(db.state(a.id), before);
});

test('DB: real group memberships, private records, public sharing and forged member rejection', (t) => {
  const { db, a, b, c } = fixture(t);
  const s = db.state(a.id);
  s.state.entries.push(entry());
  db.saveState(a.id, s.state, s.revision);
  const g = db.createGroup(a.id, 'Real group');
  const group = db.state(a.id).state.groups[0];
  assert.equal(db.joinGroup(b.id, group.code.toLowerCase()).id, g.id);
  assert.equal(db.state(c.id).state.groups.length, 0);
  let peer = db.state(b.id).state.groups[0].members[0];
  assert.equal(peer.id, a.id);
  assert.equal(peer.entries.length, 0);
  assert.equal(peer.public, false);
  assert.ok(!JSON.stringify(peer).includes(a.email));
  const updated = db.state(a.id);
  updated.state.profile.public = true;
  updated.state.groups[0].members.push({ id: c.id, name: 'Forged user' });
  db.saveState(a.id, updated.state, updated.revision);
  peer = db.state(b.id).state.groups[0].members[0];
  assert.equal(peer.entries[0].raw, entry().raw);
  assert.equal(db.state(c.id).state.groups.length, 0);
  assert.throws(() => db.poke(c.id, g.id, b.id), (e) => e.status === 403);
  db.leaveGroup(a.id, g.id);
  assert.equal(db.state(b.id).state.groups[0].ownerId, b.id);
  assert.equal(db.state(b.id).state.groups[0].members.length, 0);
  db.leaveGroup(b.id, g.id);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM groups').get().n, 0);
});

test('DB: poke delivery, duplicate protection, recipient-only read and completed-period rejection', (t) => {
  const { db, a, b, c } = fixture(t);
  const g = db.createGroup(a.id, 'Notifications');
  db.joinGroup(b.id, db.state(a.id).state.groups[0].code);
  db.poke(a.id, g.id, b.id); db.poke(a.id, g.id, b.id);
  assert.equal(db.state(b.id).state.notifications.length, 1);
  db.readNotifications(c.id);
  assert.equal(db.state(b.id).state.notifications.length, 1);
  db.readNotifications(b.id);
  assert.equal(db.state(b.id).state.notifications.length, 0);
  const bstate = db.state(b.id);
  bstate.state.entries = [entry()];
  db.saveState(b.id, bstate.state, bstate.revision);
  assert.throws(() => db.poke(a.id, g.id, b.id), (e) => e.status === 400);
});

test('DB: data, sessions, OAuth flow and AI history survive reopening the database', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aimers-db-test-'));
  const file = path.join(dir, 'test.sqlite');
  let db = new Store(file);
  try {
    const a = db.upsertUser(identity('persisted'));
    const s = db.state(a.id); s.state.entries = [entry()];
    db.saveState(a.id, s.state, s.revision);
    db.setSession('secret-session-token', a.id, Date.now() + 60000);
    db.setFlow('secret-flow-token', { nonce: 'nonce', codeVerifier: 'verifier', expires: Date.now() + 60000 });
    db.saveAiRun(a.id, 'evaluate', { answer: 'Stored answer' }, { data: { feedback: 'Stored feedback' } });
    assert.notEqual(db.db.prepare('SELECT token_hash FROM sessions').get().token_hash, 'secret-session-token');
    db.close(); db = new Store(file);
    assert.equal(db.getSession('secret-session-token').id, a.id);
    assert.equal(db.getFlow('secret-flow-token').nonce, 'nonce');
    assert.equal(db.state(a.id).state.entries[0].raw, entry().raw);
    assert.equal(db.aiHistory(a.id)[0].input.answer, 'Stored answer');
    db.prune(Date.now() + 120000);
    assert.equal(db.getSession('secret-session-token'), undefined);
    assert.equal(db.getFlow('secret-flow-token'), null);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('API: authenticated ownership, CSRF, validation, concurrent writes, group privacy and AI persistence', async (t) => {
  const { db, a, b } = fixture(t);
  db.setSession('token-a', a.id, Date.now() + 60000);
  db.setSession('token-b', b.id, Date.now() + 60000);
  let origin;
  // Inject verified identities to exercise main's API contract independently of OAuth.
  const auth = Object.assign(async () => false, {
    getUser: (req) => db.getSession(req.headers.cookie?.split('=')[1]),
    isTrustedWrite: async (req) => req.headers.origin === origin && req.headers['x-requested-with'] === 'AIMers',
  });
  const handler = createHandler({ auth, store: () => Object.assign(db, { membership: async () => ({ premium: true, plan: 'monthly', currentPeriodEnd: new Date(Date.now() + 86400000).toISOString() }) }), aiTask: async () => ({ data: { answer: 'Stored AI answer' } }) });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const request = (url, { token = 'token-a', method = 'GET', body, headers = {} } = {}) => fetch(origin + url, {
    method, headers: { cookie: `aimers_session=${token}`, origin, 'x-requested-with': 'AIMers', 'x-aimers-user': token === 'token-b' ? b.id : a.id, ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  assert.equal((await request('/api/state', { token: 'unknown' })).status, 401);
  const s = await (await request('/api/state')).json(); s.state.entries.push(entry());
  assert.equal((await request('/api/state', { method: 'PUT', body: s, headers: { origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await request('/api/state', { token: 'token-b', method: 'PUT', body: s, headers: { 'x-aimers-user': a.id } })).status, 401);
  assert.equal((await request('/api/state', { token: 'token-b', headers: { 'x-aimers-user': a.id } })).status, 401);
  assert.equal((await request('/api/state', { method: 'PUT', body: s })).status, 200);
  assert.equal((await request('/api/state', { method: 'PUT', body: s })).status, 409);
  assert.equal((await request('/api/state', { method: 'PUT', body: 'null' })).status, 400);
  assert.equal((await request('/api/state', { method: 'PUT', body: '{oops' })).status, 400);
  const bState = await (await request(`/api/state?userId=${a.id}`, { token: 'token-b' })).json();
  assert.equal(bState.state.entries.length, 0);
  assert.equal((await request('/api/ai', { method: 'POST', body: { task: 'evaluate', input: { answer: 'My answer' } } })).status, 200);
  assert.equal((await (await request('/api/ai/history')).json()).runs.length, 1);
  assert.equal((await (await request('/api/ai/history', { token: 'token-b' })).json()).runs.length, 0);
  const g = await (await request('/api/groups', { method: 'POST', body: { name: 'API group' } })).json();
  const code = db.state(a.id).state.groups[0].code;
  assert.equal((await request('/api/groups/join', { method: 'POST', token: 'token-b', body: { code } })).status, 200);
  const groupState = await (await request('/api/state', { token: 'token-b' })).json();
  assert.equal(groupState.state.groups[0].members[0].entries.length, 0);
  assert.equal((await request(`/api/groups/${g.id}/pokes`, { method: 'POST', body: { recipientId: b.id } })).status, 200);
  assert.equal((await request('/api/notifications/read', { method: 'POST', token: 'token-b' })).status, 200);
  assert.equal((await request(`/api/groups/${g.id}`, { method: 'DELETE', token: 'token-b' })).status, 200);
  assert.equal((await request('/data/aimers.sqlite')).status, 404);
  assert.equal((await request('/.env')).status, 404);
});
