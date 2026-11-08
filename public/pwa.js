export const pwa = {
  state: { ready: false, available: false, subscribed: false, pokes: true, busy: false, error: '', installable: false },
  installed() { return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone); },
  isIOS() { return /iPad|iPhone|iPod/.test(window.navigator.userAgent) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1); },
  listen() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault(); this.installPrompt = event; this.state.installable = true; this.changed?.();
    });
    window.addEventListener('appinstalled', () => { this.state.installable = false; this.changed?.(); });
  },
  async install() {
    if (!this.installPrompt) return;
    await this.installPrompt.prompt();
    await this.installPrompt.userChoice;
    this.installPrompt = null; this.state.installable = false; this.changed?.();
  },
  async start(api, user, changed) {
    this.api = api; this.user = user; this.changed = changed;
    const nav = window.navigator;
    if (!('serviceWorker' in nav) || !window.isSecureContext) { this.state.ready = true; return; }
    try {
      this.registration = await nav.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      this.config = await api('/api/push/config');
      this.state.available = Boolean(this.config.enabled && 'PushManager' in window && 'Notification' in window);
      if (user && this.state.available) {
        const subscription = await this.registration.pushManager.getSubscription();
        if (subscription) {
          const status = await api('/api/push/subscription', { method: 'POST', body: { action: 'get', subscription: { endpoint: subscription.endpoint } } });
          this.state.subscribed = Boolean(status.subscribed && window.Notification.permission === 'granted');
          this.state.pokes = status.pokes ?? true;
        }
      }
    } catch { this.state.error = '앱 설치 또는 알림 설정을 확인하지 못했어요. 연결 후 다시 열어 주세요.'; }
    this.state.ready = true; changed();
  },
  async enable() {
    if (!this.user || !this.state.available) throw new Error('로그인과 알림 서버 설정을 먼저 확인해 주세요.');
    if (this.isIOS() && !this.installed()) throw new Error('홈 화면에 추가한 AIMers 앱에서 알림을 켜 주세요.');
    // Request immediately in the click handler, before any network or service-worker awaits.
    const permission = await window.Notification.requestPermission();
    if (permission !== 'granted') throw new Error('기기 설정에서 AIMers의 알림을 허용해 주세요.');
    await window.navigator.serviceWorker.ready;
    let subscription = await this.registration.pushManager.getSubscription();
    // An unknown endpoint can belong to a previously signed-in account. Rotate it instead of taking it over.
    if (subscription && !this.state.subscribed) { await subscription.unsubscribe(); subscription = null; }
    if (!subscription) {
      const key = this.config.publicKey.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(window.atob(key + '='.repeat((4 - key.length % 4) % 4)), (ch) => ch.charCodeAt(0));
      subscription = await this.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    }
    try {
      await this.api('/api/push/subscription', { method: 'POST', body: { action: 'save', subscription: { ...subscription.toJSON(), pokes: this.state.pokes } } });
    } catch (error) { await subscription.unsubscribe(); throw error; }
    this.state.subscribed = true; this.state.error = '';
  },
  async setPokes(enabled) {
    const subscription = await this.registration?.pushManager?.getSubscription();
    if (!subscription || !this.state.subscribed) throw new Error('이 기기에서 알림 받기를 먼저 켜 주세요.');
    await this.api('/api/push/subscription', { method: 'POST', body: { action: 'save', subscription: { ...subscription.toJSON(), pokes: enabled } } });
    this.state.pokes = enabled;
  },
  async disable() {
    const subscription = await this.registration?.pushManager?.getSubscription();
    if (subscription) {
      try { await this.api('/api/push/subscription', { method: 'POST', body: { action: 'delete', subscription: { endpoint: subscription.endpoint } } }); }
      catch { /* A successful browser unsubscribe also prevents delivery; stale server rows expire on 410. */ }
      finally {
        const removed = await subscription.unsubscribe();
        if (!removed && await this.registration.pushManager.getSubscription()) throw new Error('기기의 알림 구독을 해제하지 못했어요. 다시 시도해 주세요.');
      }
    }
    this.state.subscribed = false;
  },
};
