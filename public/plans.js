export const PREMIUM_TASKS = new Set(['questions', 'evaluate', 'match', 'insight']);
export const PLANS = Object.freeze({
  monthly: Object.freeze({ name: '월간', price: 2990, label: '2,990원', period: '월' }),
  annual: Object.freeze({ name: '연간', price: 29900, label: '29,900원', period: '년' }),
});

export function hasPremium(membership, now = Date.now()) {
  return membership?.premium === true && Boolean(PLANS[membership.plan])
    && Number.isFinite(Date.parse(membership.currentPeriodEnd)) && Date.parse(membership.currentPeriodEnd) > now;
}
