import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { defaultProfile, validateState } from './db.js';
import { sessionManager } from './public/session.js';
import { pwa } from './public/pwa.js';
import { payments } from './public/payments.js';

let moduleId = 0;
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); }
  assert.fail('UI did not reach the expected state');
}
async function app(t, { failLoad = false, legacy = false, oldLegacy = false, failAuth = false, plan = 'free', failMembership = false, initialRoute = 'profile', pauseMembership = false, failAiHistory = false, enableCheckout = false, confirmStatus = 'PAID', paymentReturn = false } = {}) {
  const html = await readFile(new URL('./public/index.html', import.meta.url), 'utf8');
  const paymentId = 'aimers-00000000-0000-4000-8000-000000000001';
  const dom = new JSDOM(html, { url: `http://localhost:3000/${paymentReturn ? `?payment_return=1&paymentId=${paymentId}` : ''}#/${initialRoute}` });
  let releaseMembership;
  const membershipGate = pauseMembership ? new Promise((resolve) => { releaseMembership = resolve; }) : null;
  t.after(() => { releaseMembership?.(); dom.window.close(); });
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
  let testPushes = 0;
  let canceled = false;
  let membershipReads = 0;
  let aiHistoryReads = 0;
  let paymentPrepares = 0; let paymentConfirms = 0; let sdkCalls = 0; let failConfirmation = false;
  t.mock.method(payments, 'request', async (order) => { sdkCalls++; assert.equal(order.paymentId, paymentId); return { paymentId }; });
  const session = { enabled: true, user: { id: 'internal-id', googleSub: 'google-user', name: 'Google User', email: 'user@example.com' } };
  t.mock.method(sessionManager, 'initialize', async () => { if (failAuth) throw Object.assign(new Error('로그인 복원 실패'), { status: failAuth === 'expired' ? 401 : 503 }); return session; });
  t.mock.method(sessionManager, 'current', async () => session);
  t.mock.method(sessionManager, 'headers', async () => ({ authorization: 'Bearer test-access-token' }));
  if (legacy) dom.window.localStorage.setItem('aimers-v1:google:google-user', JSON.stringify({ ...state, profile: { ...state.profile, name: 'Old User' } }));
  // 초기 버전 형식: 화면 모드(theme)가 없고 글꼴(font)·글자 크기 90이 들어 있다
  if (oldLegacy) dom.window.localStorage.setItem('aimers-v1', JSON.stringify({ v: 1,
    profile: { name: 'First Version', bio: '', photo: '', public: true, periodDays: 7, startDate: '2025-09-13', notify: false, font: 'pretendard', fontScale: 90 },
    categories: ['프로젝트'], entries: [{ id: 'old1', date: '2025-10-01', category: '동아리', title: '옛 기록', summary: '요약', raw: '원문', tags: ['협업'], qa: [] }], groups: [], pokes: {} }));
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/payments/prepare' || url === '/api/payments/resume') { paymentPrepares++; return Response.json({ paymentId, totalAmount: 2990, payMethod: 'CARD' }); }
    if (url === '/api/payments/confirm') {
      paymentConfirms++;
      if (failConfirmation) return Response.json({ error: '결제 확인 연결 실패' }, { status: 502 });
      if (confirmStatus === 'PAID') plan = 'monthly';
      return Response.json({ paymentId, status: confirmStatus });
    }
    if (url === '/api/push/test') { testPushes++; return Response.json({ sent: 1, failed: 0, expired: 0 }); }
    if (url === '/api/membership') { membershipReads++; if (membershipGate) await membershipGate; return failMembership ? Response.json({ error: 'Unavailable' }, { status: 500 }) : Response.json({ premium: plan !== 'free', plan, currentPeriodEnd: new Date(Date.now() + 86400000 * 30).toISOString(), cancelAtPeriodEnd: canceled, checkoutEnabled: enableCheckout }); }
    if (url === '/api/membership/cancel') { canceled = true; return Response.json({ premium: plan !== 'free', plan, currentPeriodEnd: new Date(Date.now() + 86400000 * 30).toISOString(), cancelAtPeriodEnd: canceled, checkoutEnabled: false }); }
    if (url === '/api/auth/session') return Response.json({ enabled: true, user: { id: 'internal-id', googleSub: 'google-user', name: 'Google User', email: 'user@example.com' } });
    if (url === '/api/ai/history') { aiHistoryReads++; return failAiHistory ? Response.json({ error: 'History unavailable' }, { status: 503 }) : Response.json({ runs: [{ task: 'followup', result: { data: {} } }] }); }
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
  return { dom, changeName, writes, get state() { return state; }, get reads() { return reads; }, get testPushes() { return testPushes; },
    get paymentPrepares() { return paymentPrepares; }, get paymentConfirms() { return paymentConfirms; }, get sdkCalls() { return sdkCalls; }, failConfirmation: (value) => { failConfirmation = value; }, setPaymentStatus: (value) => { confirmStatus = value; },
    releaseMembership, get membershipReads() { return membershipReads; }, get aiHistoryReads() { return aiHistoryReads; },
    offline: (value) => { failSave = value; }, conflict: () => { stale = true; },
    pauseNextSave: () => { let release; pause = new Promise((resolve) => { release = resolve; }); return () => release(); },
  };
}

test('UI: dashboard renders without membership or history requests, and paid routes wait safely for one deduplicated lookup', { timeout: 30000 }, async (t) => {
  const a = await app(t, { initialRoute: 'dashboard', pauseMembership: true, plan: 'annual' });
  assert.ok(document.querySelector('[data-act="day-record"]'));
  assert.equal(a.membershipReads, 0); assert.equal(a.aiHistoryReads, 0);
  location.hash = '#/services';
  await until(() => document.querySelector('#membership-loading'));
  assert.equal(document.querySelector('.premium-hero'), null);
  assert.equal(document.querySelector('.svc'), null);
  window.dispatchEvent(new a.dom.window.HashChangeEvent('hashchange'));
  await tick();
  assert.equal(a.membershipReads, 1);
  a.releaseMembership();
  await until(() => document.querySelector('.svc'));
  assert.equal(document.querySelector('#membership-loading'), null);
});

test('UI: a slow plan lookup does not delay the profile or replace a focused draft when it resolves', { timeout: 30000 }, async (t) => {
  const a = await app(t, { pauseMembership: true });
  const field = document.querySelector('#pf-name');
  assert.ok(field);
  assert.equal(field.disabled, false);
  assert.match(document.querySelector('#membership-slot').textContent, /요금제를 확인/);
  field.focus(); field.value = 'Unsaved draft';
  a.releaseMembership();
  await until(() => document.querySelector('.membership-card'));
  assert.equal(document.querySelector('#pf-name'), field);
  assert.equal(field.value, 'Unsaved draft');
  assert.equal(document.activeElement, field);
  assert.equal(a.aiHistoryReads, 0);
});

test('UI: foreground checks throttle duplicate reads and do not wait for a pending membership lookup', { timeout: 30000 }, async (t) => {
  const a = await app(t, { pauseMembership: true });
  const field = document.querySelector('#pf-name');
  const initialReads = a.reads;
  window.dispatchEvent(new a.dom.window.Event('focus'));
  await tick();
  assert.equal(a.reads, initialReads);
  const later = Date.now() + 16000;
  t.mock.method(Date, 'now', () => later);
  window.dispatchEvent(new a.dom.window.Event('focus'));
  await until(() => a.reads === initialReads + 1);
  await tick();
  assert.equal(document.querySelector('#pf-name'), field);
  assert.equal(a.membershipReads, 1);
  a.releaseMembership();
  await until(() => document.querySelector('.membership-card'));
});

test('UI: export fetches history on demand and still exports records if history is unavailable', async (t) => {
  const a = await app(t, { failAiHistory: true });
  let downloaded;
  t.mock.method(URL, 'createObjectURL', (blob) => { downloaded = blob; return 'blob:test-export'; });
  t.mock.method(a.dom.window.HTMLAnchorElement.prototype, 'click', () => {});
  assert.equal(a.aiHistoryReads, 0);
  document.querySelector('[data-act="export-data"]').click();
  await until(() => downloaded);
  const data = JSON.parse(await downloaded.text());
  assert.equal(a.aiHistoryReads, 1);
  assert.equal(data.state.profile.name, 'DB User');
  assert.match(data.aiHistoryError, /AI 활동/);
});

test('UI: export includes freshly fetched AI history without reading it during startup', async (t) => {
  const a = await app(t);
  let downloaded;
  t.mock.method(URL, 'createObjectURL', (blob) => { downloaded = blob; return 'blob:test-export'; });
  t.mock.method(a.dom.window.HTMLAnchorElement.prototype, 'click', () => {});
  assert.equal(a.aiHistoryReads, 0);
  document.querySelector('[data-act="export-data"]').click();
  await until(() => downloaded);
  const data = JSON.parse(await downloaded.text());
  assert.equal(data.aiRuns[0].task, 'followup');
  assert.equal(data.aiHistoryError, undefined);
});

test('UI: free users see pricing on every AIMers+ route and retain profile editing', async (t) => {
  await app(t);
  assert.match(document.querySelector('.membership-card').textContent, /AIMers 무료/);
  for (const path of ['services', 'services/interview', 'services/match', 'services/insight']) {
    location.hash = `#/${path}`;
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(document.querySelector('.premium-hero'));
    assert.match(document.querySelector('#main').textContent, /2,990원/);
    assert.match(document.querySelector('#main').textContent, /29,900원/);
    assert.equal(document.querySelector('[data-act="iv-make"]'), null);
    assert.equal(document.querySelector('[data-act="ins-run"]'), null);
  }
  document.querySelector('[data-act="plan-interest"]').click(); await tick();
  assert.match(document.querySelector('#ask').textContent, /결제 서비스를 준비 중/);
  assert.ok(document.querySelector('.premium-hero'));
  location.hash = '#/profile';
  await until(() => document.querySelector('#pf-name'));
  assert.equal(document.querySelector('#pf-name').disabled, false);
});

test('UI: premium passes show expiration without renewal or cancellation language and retain tools', async (t) => {
  await app(t, { plan: 'annual' });
  assert.match(document.querySelector('.membership-card').textContent, /AIMers\+ 연간/);
  assert.equal(document.querySelector('[data-act="plan-cancel"]'), null);
  assert.doesNotMatch(document.querySelector('#main').textContent, /자동|갱신|해지|관리자가 부여/);
  location.hash = '#/services';
  await until(() => document.querySelector('.svc[href="#/services/interview"]'));
  assert.equal(document.querySelector('.premium-hero'), null);
  location.hash = '#/services/interview';
  await until(() => document.querySelector('#topbar h1').textContent === '면접 예상 질문');
  assert.equal(document.querySelector('.premium-hero'), null);
});

test('UI: one-time checkout prevents double clicks and grants access only after server confirmation', async (t) => {
  const a = await app(t, { enableCheckout: true, initialRoute: 'services' });
  await until(() => document.querySelector('[data-act="plan-interest"]:not(:disabled)'));
  const button = document.querySelector('[data-act="plan-interest"]');
  button.click(); button.click();
  await until(() => document.querySelector('.svc'));
  assert.equal(a.paymentPrepares, 1); assert.equal(a.sdkCalls, 1); assert.equal(a.paymentConfirms, 1);
  assert.equal(localStorage.getItem('aimers-payment:internal-id'), null);
});

test('UI: lost confirmation keeps an owner-scoped recovery token and retry never creates another charge', async (t) => {
  const a = await app(t, { enableCheckout: true, initialRoute: 'services' });
  a.failConfirmation(true);
  await until(() => document.querySelector('[data-act="plan-interest"]:not(:disabled)'));
  document.querySelector('[data-act="plan-interest"]').click();
  await until(() => document.querySelector('[data-act="payment-retry"]'));
  assert.ok(localStorage.getItem('aimers-payment:internal-id'));
  assert.ok(document.querySelector('.premium-hero'));
  a.failConfirmation(false);
  document.querySelector('[data-act="payment-retry"]').click();
  await until(() => document.querySelector('.svc'));
  assert.equal(a.sdkCalls, 1); assert.equal(a.paymentPrepares, 1); assert.equal(a.paymentConfirms, 2);
});

test('UI: mobile redirect verifies payment, cleans return parameters and updates membership', async (t) => {
  const a = await app(t, { enableCheckout: true, paymentReturn: true });
  await until(() => document.querySelector('.membership-card')?.textContent.includes('AIMers+ 월간'));
  assert.equal(a.paymentConfirms, 1); assert.equal(a.sdkCalls, 0);
  assert.equal(location.search, ''); assert.equal(location.hash, '#/profile');
});

test('UI: closing an unpaid checkout can resume the same order without losing the selected purchase', async (t) => {
  const a = await app(t, { enableCheckout: true, initialRoute: 'services', confirmStatus: 'PENDING' });
  await until(() => document.querySelector('[data-act="plan-interest"]:not(:disabled)'));
  document.querySelector('[data-act="plan-interest"]').click();
  await until(() => document.querySelector('[data-act="payment-resume"]'));
  assert.ok(document.querySelector('.premium-hero'));
  a.setPaymentStatus('PAID');
  document.querySelector('[data-act="payment-resume"]').click();
  await until(() => document.querySelector('.svc'));
  assert.equal(a.sdkCalls, 2);
});

test('UI: unavailable membership fails closed without blocking the free diary', async (t) => {
  await app(t, { failMembership: true });
  assert.ok(document.querySelector('[data-act="plan-refresh"]'));
  assert.ok(document.querySelector('#pf-name'));
  location.hash = '#/services/insight';
  await until(() => document.querySelector('.premium-hero'));
  assert.equal(document.querySelector('[data-act="ins-run"]'), null);
  assert.ok(document.querySelector('[data-act="plan-refresh"]'));
});

test('UI: an invalidated session offers explicit sign-in instead of an endless reconnect loop', async (t) => {
  const a = await app(t, { failAuth: 'expired' });
  assert.ok(document.querySelector('[data-act="login"]'));
  assert.equal(document.querySelector('[data-act="retry-auth"]'), null);
  assert.equal(a.writes.length, 0);
});

test('UI: temporary auth restoration errors show retry without opening a guest account or writing data', async (t) => {
  const a = await app(t, { failAuth: true });
  assert.ok(document.querySelector('[data-act="retry-auth"]'));
  assert.equal(document.querySelector('#pf-name'), null);
  assert.equal(document.querySelector('[data-act="login"]'), null);
  assert.equal(a.writes.length, 0);
  assert.equal(a.reads, 0);
});

test('UI: device notification controls enable reminders and preserve a visible error on failure', async (t) => {
  const a = await app(t);
  Object.assign(pwa.state, { ready: true, available: true, subscribed: false, busy: false, error: '' });
  t.mock.method(pwa, 'enable', async () => { pwa.state.subscribed = true; });
  t.mock.method(pwa, 'disable', async () => { pwa.state.subscribed = false; });
  t.mock.method(pwa, 'setPokes', async () => { throw new Error('알림 설정 저장 실패'); });
  window.dispatchEvent(new a.dom.window.HashChangeEvent('hashchange'));
  assert.equal(document.querySelector('[data-act="push-test"]').disabled, true);
  document.querySelector('[data-act="push-enable"]').click();
  await until(() => a.state.profile.notify && document.querySelector('[data-act="push-disable"]'));
  assert.equal(document.querySelector('#pf-notify').disabled, false);
  assert.match(document.querySelector('[for="pf-notify"]').textContent, /매일 기록 알림/);
  document.querySelector('[data-act="push-test"]').click();
  await until(() => a.testPushes === 1 && !document.querySelector('[data-act="push-test"]').disabled);
  assert.match(document.querySelector('#toast').textContent, /테스트 알림을 전송/);
  document.querySelector('#push-pokes').dispatchEvent(new a.dom.window.Event('change', { bubbles: true }));
  await until(() => document.querySelector('#pwa-title').parentElement.textContent.includes('알림 설정 저장 실패'));
  document.querySelector('[data-act="push-disable"]').click();
  await until(() => document.querySelector('[data-act="push-enable"]'));
  assert.equal(document.querySelector('#pf-notify').disabled, true);
  Object.assign(pwa.state, { ready: true, available: false, subscribed: false, busy: false, error: '' });
});

test('UI: loads the DB profile and queues overlapping edits with current revisions', async (t) => {
  const a = await app(t);
  assert.equal(document.querySelector('#pf-name').value, 'DB User');
  assert.equal(document.querySelector('#save-status').textContent, '');
  const release = a.pauseNextSave();
  a.changeName('First edit');
  a.changeName('Second edit');
  release();
  await until(() => a.writes.length === 2 && /저장했어요/.test(document.querySelector('#save-status').textContent));
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
  assert.equal(a.aiHistoryReads, 0); // AI results must not wait for an additional history request.
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
