import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPaymentService, paymentConfig } from './payments.js';
import { createHandler, readPaymentWebhook } from './server.js';

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'a@example.com' };
const other = '00000000-0000-4000-8000-000000000002';
const id = 'aimers-00000000-0000-4000-8000-000000000001';
const env = { PORTONE_STORE_ID: 'store-test', PORTONE_CHANNEL_KEY: 'channel-test', PORTONE_API_SECRET: 'private-api', PORTONE_WEBHOOK_SECRET: Buffer.from('webhook-secret').toString('base64'), SUPABASE_URL: 'https://db.example.com', SUPABASE_SECRET_KEY: 'private-db', PAYMENT_ORIGIN: 'https://app.example.com' };
function fixture() {
  const order = { id, user_id: user.id, plan: 'monthly', amount: 2990, store_id: env.PORTONE_STORE_ID, channel_key: env.PORTONE_CHANNEL_KEY };
  let payment = { id, storeId: order.store_id, channel: { key: order.channel_key }, status: 'PAID', customer: { id: user.id }, amount: { total: 2990, cancelled: 0 }, currency: 'KRW', paidAt: new Date().toISOString() };
  const calls = []; let reads = 0; let providerError;
  const service = createPaymentService({ env,
    clientFactory: (_url, key) => { assert.equal(key, env.SUPABASE_SECRET_KEY); return { rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'app_payment_create') return { data: { ...order, id: args.p_id, plan: args.p_plan, amount: args.p_plan === 'annual' ? 29900 : 2990 } };
      if (name === 'app_payment_order') return { data: args.p_user && args.p_user !== user.id ? null : order };
      return { data: { paymentId: id, status: args.p_status } };
    } }; },
    providerFactory: () => ({ getPayment: async () => { reads++; if (providerError) throw providerError; return payment; } }),
  });
  return { service, calls, get payment() { return payment; }, set payment(value) { payment = value; }, get reads() { return reads; }, error(value) { providerError = value; } };
}

test('payments: config fails closed and never exposes secrets; SDK orders use server prices and authenticated customer', async () => {
  for (const key of Object.keys(env)) assert.equal(paymentConfig({ ...env, [key]: '' }).enabled, false, key);
  const config = paymentConfig(env);
  assert.equal(config.enabled, true);
  assert.doesNotMatch(JSON.stringify(config), /private|webhook-secret/);
  const f = fixture();
  const order = await f.service.prepare(user, 'annual');
  assert.equal(order.totalAmount, 29900); assert.equal(order.customer.customerId, user.id);
  assert.equal(order.redirectUrl, 'https://app.example.com/?payment_return=1#/profile');
  assert.equal(order.payMethod, 'CARD'); assert.equal(order.currency, 'KRW');
  assert.equal(order.billingKey, undefined);
  await assert.rejects(f.service.prepare(user, '__proto__'), { status: 400 });
  await assert.rejects(createPaymentService({ env: {} }).prepare(user, 'monthly'), { status: 503 });
});

test('payments: another owner cannot confirm or resume an order; forged payment attributes never grant access', async () => {
  const f = fixture();
  await assert.rejects(f.service.confirm({ id: other }, id), { status: 404 });
  await assert.rejects(f.service.resume({ id: other }, id), { status: 404 });
  assert.equal(f.reads, 0);
  const original = structuredClone(f.payment);
  for (const patch of [{ id: 'forged' }, { storeId: 'other' }, { channel: { key: 'other' } }, { customer: { id: other } }, { amount: { total: 1 } }, { currency: 'USD' }, { paidAt: 'invalid' }]) {
    f.payment = { ...original, ...patch };
    await assert.rejects(f.service.confirm(user, id), { status: 409 });
  }
  assert.equal(f.calls.filter(([name]) => name === 'app_payment_apply').length, 0);
});

test('payments: provider confirmation distinguishes success, waiting, failure and full or partial refund', async () => {
  const f = fixture();
  assert.equal((await f.service.confirm(user, id)).status, 'PAID');
  f.payment.status = 'READY'; delete f.payment.channel;
  assert.equal((await f.service.confirm(user, id)).status, 'PENDING');
  f.payment.status = 'FAILED';
  assert.equal((await f.service.confirm(user, id)).status, 'FAILED');
  f.payment.channel = { key: env.PORTONE_CHANNEL_KEY }; f.payment.status = 'PARTIAL_CANCELLED'; f.payment.amount.cancelled = 100;
  assert.equal((await f.service.confirm(user, id)).status, 'PARTIAL_REFUNDED');
  f.payment.status = 'CANCELLED'; delete f.payment.paidAt;
  assert.equal((await f.service.confirm(user, id)).status, 'REFUNDED');
  f.error({ data: { type: 'PAYMENT_NOT_FOUND' } });
  assert.equal((await f.service.confirm(user, id)).status, 'PENDING');
  f.error(new Error('offline'));
  await assert.rejects(f.service.confirm(user, id), { status: 502 });
});

function signed(payload) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return { 'webhook-id': 'event-id', 'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${createHmac('sha256', Buffer.from(env.PORTONE_WEBHOOK_SECRET, 'base64')).update(`event-id.${timestamp}.${payload}`).digest('base64')}` };
}
test('payments: real SDK verifies raw webhook signatures and reloads provider state instead of trusting event type', async () => {
  const f = fixture();
  const payload = JSON.stringify({ type: 'Transaction.Paid', timestamp: new Date().toISOString(), data: { storeId: env.PORTONE_STORE_ID, paymentId: id, transactionId: 'tx' } });
  await assert.rejects(f.service.webhook(payload, {}), { status: 400 });
  await assert.rejects(f.service.webhook(payload + ' ', signed(payload)), { status: 400 });
  f.payment.status = 'CANCELLED';
  assert.deepEqual(await f.service.webhook(payload, signed(payload)), { received: true });
  assert.equal(f.calls.at(-1)[1].p_status, 'REFUNDED');
  assert.equal(f.reads, 1);
  const unknown = JSON.stringify({ type: 'Future.Event', data: {} });
  assert.deepEqual(await f.service.webhook(unknown, signed(unknown)), { received: true });
});

test('payments: webhook raw bytes survive parsed-body adapters; oversized or reconstructed JSON is rejected', async () => {
  const raw = '{ "keep": "spacing" }';
  const req = Readable.from([Buffer.from(raw)]); req.body = { keep: 'spacing' };
  assert.equal(await readPaymentWebhook(req), raw);
  await assert.rejects(readPaymentWebhook({ body: { keep: 'spacing' } }), { status: 400 });
  await assert.rejects(readPaymentWebhook(Readable.from(['x'.repeat(100001)])), { status: 413 });
});

test('payments API: checkout requires auth and trusted writes, while webhook uses its own verification', async () => {
  let authenticated = true; let trusted = true; let prepared;
  const auth = Object.assign(async () => false, { getUser: async () => authenticated ? user : null, isTrustedWrite: async () => trusted });
  const handler = createHandler({ auth, store: () => ({ membership: async () => ({ premium: false }) }), payments: {
    config: () => ({ enabled: true }), prepare: async (owner, plan) => { prepared = { owner, plan }; return { paymentId: id }; },
    webhook: async (raw) => { assert.equal(raw, 'raw'); return { received: true }; },
  } });
  async function request(path, body, method = 'POST', headers = { 'x-aimers-user': user.id }) {
    let status; let data;
    await handler({ url: path, method, headers, body }, { writeHead: (s) => { status = s; }, end: (s) => { data = JSON.parse(s); } });
    return { status, data };
  }
  assert.equal((await request('/api/payments/prepare', { plan: 'monthly', amount: 1, userId: other })).status, 200);
  assert.equal(prepared.owner.id, user.id); assert.equal(prepared.plan, 'monthly');
  trusted = false; assert.equal((await request('/api/payments/prepare', {})).status, 403);
  authenticated = false; assert.equal((await request('/api/payments/prepare', {})).status, 401);
  assert.equal((await request('/api/payments/webhook', 'raw', 'POST', {})).status, 200);
});

test('payment SQL: grants are private, atomic, idempotent, calendar-based and revocable without removing other rights', { timeout: 60000 }, async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users(id uuid primary key); insert into auth.users values ('${user.id}'), ('${other}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    for (const file of ['202611080004_premium_membership.sql', '202611080007_payment_passes.sql']) await db.exec(await readFile(new URL(`./supabase/migrations/${file}`, import.meta.url), 'utf8'));
    const query = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
    const create = (paymentId, plan = 'monthly') => query('select public.app_payment_create($1, $2, $3, $4, $5) as value', [paymentId, user.id, plan, 'store', 'channel']);
    const apply = (paymentId, status, paid = new Date().toISOString()) => query('select public.app_payment_apply($1, $2, $3) as value', [paymentId, status, paid]);
    const membership = () => query('select public.app_membership() as value');
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user.id}';`);
    assert.equal((await membership()).premium, false);
    await assert.rejects(db.query('select * from public.app_payment_orders'), /permission denied/);
    await assert.rejects(create(id), /permission denied/);
    await assert.rejects(db.query('select public.app_cancel_membership()'), /permission denied/);
    await db.exec('reset role; set role service_role;');
    assert.equal((await create(id)).amount, 2990);
    const secondId = 'aimers-00000000-0000-4000-8000-000000000003';
    assert.equal((await create(secondId)).id, id);
    assert.equal(await query('select public.app_payment_order($1, $2) as value', [id, other]), null);
    await apply(id, 'PAID');
    const period = await query('select public.app_payment_order($1, null) as value', [id]);
    await apply(id, 'PAID');
    assert.equal((await query('select public.app_payment_order($1, null) as value', [id])).period_end, period.period_end);
    await apply(id, 'FAILED');
    assert.equal((await query('select public.app_payment_order($1, null) as value', [id])).status, 'PAID');
    await create(secondId, 'annual'); await apply(secondId, 'PAID');
    const stacked = await query('select public.app_payment_order($1, null) as value', [secondId]);
    assert.equal(stacked.period_start, period.period_end);
    await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${user.id}';`);
    assert.equal((await membership()).currentPeriodEnd, stacked.period_end);
    await db.exec('reset role; set role service_role;');
    await apply(id, 'REFUNDED'); await apply(id, 'PAID');
    assert.equal((await query('select public.app_payment_order($1, null) as value', [id])).status, 'REFUNDED');
    await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${user.id}';`);
    assert.equal((await membership()).plan, 'annual');
    await db.exec(`reset role; insert into public.app_subscriptions(user_id, plan, current_period_end) values ('${user.id}', 'monthly', now() + interval '1 month'); set role service_role;`);
    await apply(secondId, 'REFUNDED');
    await db.exec(`reset role; set role authenticated;`);
    assert.equal((await membership()).plan, 'monthly');
    await db.exec(`set request.jwt.claim.sub = '${other}';`);
    assert.equal((await membership()).premium, false);
    await db.exec(`reset role; insert into public.app_subscriptions(user_id, plan, current_period_start, current_period_end) values ('${other}', 'annual', now() + interval '1 year', now() + interval '2 years'); set role service_role;`);
    const calendarId = 'aimers-00000000-0000-4000-8000-000000000004';
    await query('select public.app_payment_create($1, $2, $3, $4, $5) as value', [calendarId, other, 'monthly', 'store', 'channel']);
    await apply(calendarId, 'PAID', '2026-01-31T14:30:00Z');
    const calendar = await query('select public.app_payment_order($1, null) as value', [calendarId]);
    assert.equal(Date.parse(calendar.period_end), Date.parse('2026-02-28T14:30:00Z'));
  } finally { await db.close(); }
});
