import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { PaymentClient, Webhook } from '@portone/server-sdk';
import { PLANS } from './public/plans.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const validId = (id) => typeof id === 'string' && /^aimers-[a-f0-9-]{36}$/.test(id);
export function paymentConfig(env = process.env) {
  let origin;
  try { const url = new URL(env.PAYMENT_ORIGIN); if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) origin = url.origin; } catch { /* Disabled until configured. */ }
  const configured = Boolean(env.PORTONE_STORE_ID && env.PORTONE_CHANNEL_KEY && env.PORTONE_API_SECRET && env.PORTONE_WEBHOOK_SECRET && env.SUPABASE_URL && (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY) && origin);
  const enabled = configured && env.PAYMENTS_ENABLED === '1';
  return { enabled, configured, ...(configured ? { storeId: env.PORTONE_STORE_ID, channelKey: env.PORTONE_CHANNEL_KEY, origin } : {}) };
}

export function createPaymentService({ env = process.env, clientFactory = createClient, providerFactory = PaymentClient, verify = Webhook.verify } = {}) {
  const config = () => paymentConfig(env);
  const ready = () => { if (!config().configured) fail('현재 결제 서비스를 준비 중입니다.', 503); };
  const acceptingPayments = () => { if (!config().enabled) fail('현재 결제 서비스를 준비 중입니다.', 503); };
  const rpc = async (name, args) => {
    ready();
    const client = clientFactory(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc(name, args);
    if (error) { if (error.message?.includes('PAYMENT_NOT_FOUND')) fail('결제 내역을 찾을 수 없어요.', 404); throw new Error(`Payment DB operation failed: ${name}`); }
    return data;
  };
  const checkoutOptions = (order, user) => ({ paymentId: order.id, storeId: order.store_id, channelKey: order.channel_key,
    orderName: `AIMers ${order.plan === 'annual' ? '1년' : '1개월'} 이용권`, totalAmount: order.amount, currency: 'KRW', payMethod: 'CARD',
    customer: { customerId: user.id, ...(user.email ? { email: user.email } : {}), ...(user.user_metadata?.full_name || user.name ? { fullName: user.user_metadata?.full_name || user.name } : {}) },
    redirectUrl: `${config().origin}/?payment_return=1#/profile` });
  async function reconcile(id, userId = null) {
    ready();
    if (!validId(id)) fail('결제 번호가 올바르지 않아요.');
    const order = await rpc('app_payment_order', { p_id: id, p_user: userId });
    if (!order) fail('결제 내역을 찾을 수 없어요.', 404);
    // Always query PortOne. Neither the browser result nor webhook payload grants access.
    let payment;
    try { payment = await providerFactory({ secret: env.PORTONE_API_SECRET, storeId: order.store_id }).getPayment({ paymentId: id }); }
    catch (error) {
      if (error.data?.type === 'PAYMENT_NOT_FOUND') return { paymentId: id, status: 'PENDING' };
      fail('결제 결과를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.', 502);
    }
    const paid = ['PAID', 'PARTIAL_CANCELLED'].includes(payment.status);
    if (payment.id !== id || payment.storeId !== order.store_id || payment.amount?.total !== order.amount || payment.currency !== 'KRW' || (payment.channel?.key !== order.channel_key && (paid || payment.channel?.key)) || payment.customer?.id !== order.user_id) {
      fail('결제 정보가 주문과 일치하지 않아요. 결제 내역 확인이 필요해요.', 409);
    }
    if (!['PAID', 'PARTIAL_CANCELLED', 'CANCELLED', 'FAILED', 'READY', 'PAY_PENDING', 'VIRTUAL_ACCOUNT_ISSUED'].includes(payment.status)) fail('결제 상태를 확인하지 못했어요.', 502);
    const paidAt = payment.paidAt || order.paid_at;
    if (paid && (!Number.isFinite(Date.parse(paidAt)) || Date.parse(paidAt) > Date.now() + 300_000)) fail('결제 시각을 확인하지 못했어요.', 409);
    const status = payment.status === 'CANCELLED' || payment.amount.cancelled === order.amount ? 'REFUNDED' : payment.status === 'PARTIAL_CANCELLED' || (payment.amount.cancelled || 0) > 0 ? 'PARTIAL_REFUNDED' : payment.status === 'PAID' ? 'PAID' : payment.status === 'FAILED' ? 'FAILED' : 'PENDING';
    return await rpc('app_payment_apply', { p_id: id, p_status: status, p_paid_at: paid ? paidAt : null });
  }
  return {
    config,
    async prepare(user, plan) {
      acceptingPayments();
      if (!Object.hasOwn(PLANS, plan)) fail('이용권을 선택해 주세요.');
      const { storeId, channelKey } = config();
      const order = await rpc('app_payment_create', { p_id: `aimers-${randomUUID()}`, p_user: user.id, p_plan: plan, p_store: storeId, p_channel: channelKey });
      return checkoutOptions(order, user);
    },
    async resume(user, id) {
      acceptingPayments(); if (!validId(id)) fail('결제 번호가 올바르지 않아요.');
      const order = await rpc('app_payment_order', { p_id: id, p_user: user.id });
      if (!order) fail('결제 내역을 찾을 수 없어요.', 404);
      return checkoutOptions(order, user);
    },
    confirm: (user, id) => reconcile(id, user.id),
    async webhook(payload, headers) {
      ready();
      let event;
      try { event = await verify(env.PORTONE_WEBHOOK_SECRET, payload, headers); } catch { fail('웹훅 서명을 확인할 수 없습니다.', 400); }
      if (!['Transaction.Paid', 'Transaction.Cancelled', 'Transaction.PartialCancelled', 'Transaction.Failed', 'Transaction.Ready', 'Transaction.PayPending'].includes(event.type)) return { received: true };
      if (event.data?.storeId !== env.PORTONE_STORE_ID) fail('상점 정보가 일치하지 않습니다.', 400);
      // Other applications may share the same PortOne store.
      if (!validId(event.data?.paymentId)) return { received: true };
      const order = await rpc('app_payment_order', { p_id: event.data.paymentId, p_user: null });
      if (order) await reconcile(event.data.paymentId);
      return { received: true };
    },
  };
}
export const paymentService = createPaymentService();
