import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { defaultProfile, validateState } from './db.js';
import { sessionManager } from './public/session.js';

let moduleId = 0;
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); }
  assert.fail('UI did not reach the expected state');
}
async function app(t, { failLoad = false, legacy = false, oldLegacy = false } = {}) {
  const html = await readFile(new URL('./public/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000/#/profile' });
  t.after(() => dom.window.close());
  for (const key of ['window', 'document', 'location', 'history', 'localStorage']) globalThis[key] = dom.window[key];
  globalThis.confirm = () => true;
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false; this.dispatchEvent(new dom.window.Event('close'));
  };
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    if (this.id === 'ask') queueMicrotask(() => { this.returnValue = 'ok'; this.close(); });
  };
  dom.window.scrollTo = () => {};
  let state = { v: 1, profile: defaultProfile('DB User'), entries: [], categories: ['프로젝트'], lastNotified: '', groups: [], pokes: {}, notifications: [] };
  let revision = 0;
  let failSave = false;
  let stale = false;
  let pause;
  const writes = [];
  let reads = 0;
  const session = { enabled: true, user: { id: 'internal-id', googleSub: 'google-user', name: 'Google User', email: 'user@example.com' } };
  t.mock.method(sessionManager, 'initialize', async () => session);
  t.mock.method(sessionManager, 'current', async () => session);
  t.mock.method(sessionManager, 'headers', async () => ({ authorization: 'Bearer test-access-token' }));
  if (legacy) dom.window.localStorage.setItem('aimers-v1:google:google-user', JSON.stringify({ ...state, profile: { ...state.profile, name: 'Old User' } }));
  // 초기 버전 형식: 화면 모드(theme)가 없고 글꼴(font)·글자 크기 90이 들어 있다
  if (oldLegacy) dom.window.localStorage.setItem('aimers-v1', JSON.stringify({ v: 1,
    profile: { name: 'First Version', bio: '', photo: '', public: true, periodDays: 7, startDate: '2025-09-13', notify: false, font: 'pretendard', fontScale: 90 },
    categories: ['프로젝트'], entries: [{ id: 'old1', date: '2025-10-01', category: '동아리', title: '옛 기록', summary: '요약', raw: '원문', tags: ['협업'], qa: [] }], groups: [], pokes: {} }));
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/auth/session') return Response.json({ enabled: true, user: { id: 'internal-id', googleSub: 'google-user', name: 'Google User', email: 'user@example.com' } });
    if (url === '/api/ai/history') return Response.json({ runs: [] });
    if (url === '/api/status') return Response.json({ demo: true });
    if (url === '/api/ai') {
      const { task } = JSON.parse(options.body);
      return Response.json({ data: task === 'followup' ? { enough: true, questions: [] } : { title: 'Saved diary', summary: 'Summary', tags: ['협업'] } });
    }
    if (url === '/api/state' && !options.method || url === '/api/state' && options.method === 'GET') {
      reads++;
      if (failLoad) return Response.json({ error: 'DB unavailable' }, { status: 500 });
      return Response.json({ state, revision });
    }
    if (url === '/api/state' && options.method === 'PUT') {
      const body = JSON.parse(options.body); writes.push(body);
      if (pause) { const waiting = pause; pause = null; await waiting; }
      if (failSave) throw new Error('Offline');
      if (stale || body.revision !== revision) return Response.json({ error: 'Conflict detected' }, { status: 409 });
      try { validateState(body.state); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); } // 실제 서버와 같은 검사
      state = body.state; revision++;
      return Response.json({ revision });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  await import(`./public/app.js?ui-test=${++moduleId}`);
  await tick();
  function changeName(name) {
    const field = dom.window.document.querySelector('#pf-name');
    field.value = name; field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  }
  return { dom, changeName, writes, get state() { return state; }, get reads() { return reads; },
    offline: (value) => { failSave = value; }, conflict: () => { stale = true; },
    pauseNextSave: () => { let release; pause = new Promise((resolve) => { release = resolve; }); return () => release(); },
  };
}

test('UI: loads the DB profile and queues overlapping edits with current revisions', async (t) => {
  const a = await app(t);
  assert.equal(document.querySelector('#pf-name').value, 'DB User');
  assert.match(document.querySelector('#save-status').textContent, /서버에 저장됨/);
  const release = a.pauseNextSave();
  a.changeName('First edit');
  a.changeName('Second edit');
  release();
  await until(() => a.writes.length === 2 && /서버에 저장됨/.test(document.querySelector('#save-status').textContent));
  assert.deepEqual(a.writes.map((w) => w.revision), [0, 1]);
  assert.equal(a.state.profile.name, 'Second edit');
  assert.equal(localStorage.length, 0);
});

test('UI: network failure retains edits, blocks unload and retry saves the latest data', async (t) => {
  const a = await app(t);
  a.offline(true); a.changeName('Unsaved edit');
  await until(() => document.querySelector('[data-act="retry-save"]'));
  const ev = new a.dom.window.Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(a.state.profile.name, 'DB User');
  a.offline(false); document.querySelector('[data-act="retry-save"]').click();
  await until(() => a.state.profile.name === 'Unsaved edit');
  await tick();
});

test('UI: conflict preserves local changes and offers export instead of overwriting', async (t) => {
  const a = await app(t);
  a.conflict(); a.changeName('Conflicting edit');
  await until(() => document.querySelector('#save-status [data-act="export-data"]'));
  assert.equal(a.state.profile.name, 'DB User');
  assert.equal(document.querySelector('#pf-name').value, 'Conflicting edit');
  assert.ok(document.querySelector('#save-status [data-act="reload-data"]'));
  assert.equal(document.querySelector('#save-status [data-act="retry-save"]'), null);
});

test('UI: failed initial DB load cannot show or save an empty account', async (t) => {
  const a = await app(t, { failLoad: true });
  assert.equal(document.querySelector('#pf-name'), null);
  assert.match(document.querySelector('#main').textContent, /기록을 불러오지 못했어요/);
  assert.ok(document.querySelector('[data-act="reload-data"]'));
  assert.equal(a.writes.length, 0);
});

test('UI: legacy records migrate only through explicit import and retain the local source', async (t) => {
  const a = await app(t, { legacy: true });
  assert.equal(a.writes.length, 0);
  document.querySelector('[data-act="import-legacy"]').click();
  await until(() => a.state.profile.name === 'Old User');
  await tick();
  assert.ok(localStorage.getItem('aimers-v1:google:google-user'));
  assert.equal(document.querySelector('[data-act="import-legacy"]'), null);
});

test('UI: record creation retains its draft on failure and retry never duplicates the entry', async (t) => {
  const a = await app(t);
  location.hash = '#/records';
  await until(() => document.querySelector('[data-act="record"]'));
  document.querySelector('[data-act="record"]').click();
  const raw = document.querySelector('#rec-raw');
  raw.value = 'My original experience'; raw.dispatchEvent(new a.dom.window.Event('input', { bubbles: true }));
  document.querySelector('[data-act="rec-next"]').click();
  await until(() => document.querySelector('[data-act="rec-save"]'));
  a.offline(true); document.querySelector('[data-act="rec-save"]').click();
  await until(() => document.querySelector('#sheet .error'));
  assert.equal(a.state.entries.length, 0);
  assert.equal(document.querySelector('#sheet').open, true);
  a.offline(false); document.querySelector('[data-act="rec-save"]').click();
  await until(() => a.state.entries.length === 1 && !document.querySelector('#sheet').open);
  assert.equal(a.state.entries[0].raw, 'My original experience');
  assert.equal(a.writes[0].state.entries[0].id, a.writes[1].state.entries[0].id);
});

test('UI: records from the first app version import even though their profile format is older', async (t) => {
  const a = await app(t, { oldLegacy: true });
  await until(() => document.querySelector('[data-act="import-legacy"]'));
  document.querySelector('[data-act="import-legacy"]').click();
  await until(() => a.state.profile.name === 'First Version');
  assert.equal(a.state.profile.theme, 'system');
  assert.equal(a.state.profile.fontScale, 100);
  assert.equal('font' in a.state.profile, false);
  assert.deepEqual(a.state.entries.map((e) => e.title), ['옛 기록']);
  assert.ok(a.state.categories.includes('동아리')); // 기록에만 있던 카테고리도 함께 들어온다
});

test('UI: the ⋯ menu on a record edits it in place and deletes it', async (t) => {
  const a = await app(t);
  location.hash = '#/records';
  await until(() => document.querySelector('[data-act="record"]'));
  document.querySelector('[data-act="record"]').click();
  const raw = document.querySelector('#rec-raw');
  raw.value = 'Original text'; raw.dispatchEvent(new a.dom.window.Event('input', { bubbles: true }));
  document.querySelector('[data-act="rec-next"]').click();
  await until(() => document.querySelector('[data-act="rec-save"]'));
  document.querySelector('[data-act="rec-save"]').click();
  await until(() => a.state.entries.length === 1 && !document.querySelector('#sheet').open);
  await until(() => document.querySelector('#rec-list .entry'));

  const kebab = document.querySelector('#rec-list [data-act="entry-menu"]');
  const menu = kebab.nextElementSibling;
  assert.equal(menu.hidden, true);
  kebab.click();
  assert.equal(menu.hidden, false);
  document.body.click(); // 바깥을 누르면 닫힌다
  assert.equal(menu.hidden, true);

  kebab.click();
  menu.querySelector('[data-act="edit-entry"]').click();
  assert.equal(document.querySelector('#sheet').open, true);
  const title = document.querySelector('#e-title');
  title.value = 'Edited title'; title.dispatchEvent(new a.dom.window.Event('input', { bubbles: true }));
  document.querySelector('[data-act="edit-save"]').click();
  await until(() => a.state.entries[0]?.title === 'Edited title' && !document.querySelector('#sheet').open);
  assert.equal(a.state.entries.length, 1);
  assert.equal(a.state.entries[0].raw, 'Original text');

  document.querySelector('#rec-list [data-act="entry-menu"]').click();
  document.querySelector('#rec-list [data-act="del-entry"]').click();
  await until(() => a.state.entries.length === 0);
});
