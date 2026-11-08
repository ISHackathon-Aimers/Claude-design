import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { pwa } from './public/pwa.js';

async function fixture(t, { ios = false, installed = false, denied = false, failSave = false, failDelete = false } = {}) {
  const dom = new JSDOM('', { url: 'https://example.com' });
  globalThis.window = dom.window;
  t.after(() => dom.window.close());
  const calls = [];
  const subscription = { endpoint: 'https://web.push.apple.com/device',
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } }; },
    async unsubscribe() { calls.push('unsubscribe'); current = null; return true; } };
  let current = null;
  Object.assign(pwa.state, { ready: false, available: false, subscribed: false, pokes: true, busy: false, error: '' });
  Object.defineProperty(window, 'isSecureContext', { value: true });
  window.PushManager = function () {};
  window.matchMedia = () => ({ matches: installed });
  if (ios) Object.defineProperty(window.navigator, 'userAgent', { value: 'iPhone' });
  window.Notification = { permission: denied ? 'denied' : 'granted', async requestPermission() { calls.push('permission'); return this.permission; } };
  const registration = { pushManager: {
    async getSubscription() { return current; },
    async subscribe(options) { assert.equal(options.userVisibleOnly, true); calls.push('subscribe'); current = subscription; return current; },
  } };
  Object.defineProperty(window.navigator, 'serviceWorker', { value: { ready: Promise.resolve(registration), register: async () => registration } });
  const api = async (url, options) => {
    if (url === '/api/push/config') return { enabled: true, publicKey: 'A'.repeat(87) };
    calls.push(options.body.action);
    if (options.body.action === 'save' && failSave) throw new Error('save failed');
    if (options.body.action === 'delete' && failDelete) throw new Error('delete failed');
    return { subscribed: true, pokes: options.body.subscription.pokes };
  };
  await pwa.start(api, { id: 'user' }, () => {});
  return { calls, registration };
}

test('PWA startup never requests permission and enable subscribes only after permission', async (t) => {
  const { calls } = await fixture(t);
  assert.deepEqual(calls, []);
  await pwa.enable();
  assert.deepEqual(calls, ['permission', 'subscribe', 'save']);
  assert.equal(pwa.state.subscribed, true);
  await pwa.setPokes(false);
  assert.equal(pwa.state.pokes, false);
  await pwa.disable();
  assert.equal(pwa.state.subscribed, false);
});
test('iPhone browser shows installation requirement before requesting permission', async (t) => {
  const { calls } = await fixture(t, { ios: true });
  await assert.rejects(pwa.enable(), /홈 화면/);
  assert.deepEqual(calls, []);
});
test('denied permission and failed DB registration never leave a new browser subscription', async (t) => {
  let f = await fixture(t, { denied: true });
  await assert.rejects(pwa.enable());
  assert.deepEqual(f.calls, ['permission']);
  f = await fixture(t, { failSave: true });
  await assert.rejects(pwa.enable(), /save failed/);
  assert.deepEqual(f.calls, ['permission', 'subscribe', 'save', 'unsubscribe']);
  assert.equal(pwa.state.subscribed, false);
});
test('browser unsubscribe still protects a signed-out user if server cleanup is offline', async (t) => {
  const { calls } = await fixture(t, { failDelete: true });
  await pwa.enable(); await pwa.disable();
  assert.ok(calls.includes('unsubscribe'));
  assert.equal(pwa.state.subscribed, false);
});
test('service worker displays pushes, opens the correct screen and never caches API responses', async () => {
  const handlers = {};
  const shown = [];
  let promise;
  let opened;
  const self = { location: { origin: 'https://example.com' }, addEventListener: (name, fn) => { handlers[name] = fn; },
    registration: { showNotification: async (...args) => shown.push(args) },
    clients: { matchAll: async () => [], openWindow: async (url) => { opened = url; } } };
  vm.runInNewContext(await readFile(new URL('./public/sw.js', import.meta.url), 'utf8'), { self, URL, fetch: async () => {}, caches: {} });
  handlers.push({ data: { json: () => ({ title: '기록 알림', body: '마감', url: '/#/records', tag: 'record' }) }, waitUntil: (p) => { promise = p; } });
  await promise;
  assert.equal(shown[0][0], '기록 알림');
  const click = (url) => handlers.notificationclick({ notification: { close() {}, data: { url } }, waitUntil: (p) => { promise = p; } });
  click('/#/groups/one'); await promise;
  assert.equal(opened, 'https://example.com/#/groups/one');
  click('https://attacker.example'); await promise;
  assert.equal(opened, 'https://example.com');
  let intercepted = false;
  handlers.fetch({ request: { url: 'https://example.com/api/state', mode: 'cors' }, respondWith() { intercepted = true; } });
  assert.equal(intercepted, false);
});
