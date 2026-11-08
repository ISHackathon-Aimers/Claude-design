let configuration;
let registration;

export function pushSupport() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !window.matchMedia('(display-mode: standalone)').matches && !navigator.standalone) {
    return '아이폰에서는 Safari의 공유 메뉴에서 홈 화면에 추가한 뒤, 추가된 아이콘으로 열어 주세요.';
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return '이 환경에서는 푸시 알림을 지원하지 않아요. HTTPS 주소에서 지원되는 브라우저로 열어 주세요.';
  }
  return '';
}

export async function preparePush(api) {
  if (pushSupport()) return;
  configuration = await api('/api/push/config');
  if (configuration.enabled) registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
}

export async function enablePush(api) {
  const unsupported = pushSupport();
  if (unsupported) throw new Error(unsupported);
  if (!configuration?.enabled || !registration) throw new Error('서버의 알림 설정을 불러오지 못했어요. 설정을 완료한 뒤 새로고침해 주세요.');
  // Request permission before any await so iOS sees the explicit user gesture.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('알림 권한이 꺼져 있어요. 아이폰 설정의 알림에서 AIMers의 알림 허용을 켜 주세요.');
  const ready = await navigator.serviceWorker.ready;
  const bytes = Uint8Array.from(atob(configuration.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  let subscription = await ready.pushManager.getSubscription();
  const previousKey = subscription?.options?.applicationServerKey;
  if (previousKey && String(new Uint8Array(previousKey)) !== String(bytes)) {
    await subscription.unsubscribe(); subscription = null;
  }
  subscription ||= await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  await api('/api/push/subscription', { method: 'POST', body: subscription.toJSON() });
}

export async function disablePush(api) {
  if (!('serviceWorker' in navigator)) return;
  const ready = await navigator.serviceWorker.getRegistration('/');
  const subscription = await ready?.pushManager.getSubscription();
  if (!subscription) return;
  await api('/api/push/subscription', { method: 'DELETE', body: { endpoint: subscription.endpoint } });
  await subscription.unsubscribe();
}
