import { connectCloud } from './cloud.bundle.js';

const identity = (user) => user ? {
  id: user.id, email: user.email || '',
  name: user.user_metadata?.full_name || user.email?.split('@')[0] || '나',
  googleSub: user.identities?.find((i) => i.provider === 'google')?.identity_data?.sub || user.user_metadata?.sub,
} : null;

const authError = (error) => {
  const temporary = error.name === 'AuthRetryableFetchError' || error.status >= 500;
  return Object.assign(new Error(temporary
    ? '로그인 서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.'
    : '로그인을 복원하지 못했어요. 다시 로그인해 주세요.'), { status: temporary ? 503 : 401 });
};

export function createSessionManager({ connect = connectCloud, fetcher = (...args) => fetch(...args) } = {}) {
  let client;
  let initialization;
  let refreshing;
  const read = async () => {
    if (!client) return null;
    const { data, error } = await client.auth.getSession();
    if (error) throw authError(error);
    return data.session;
  };
  return {
    async initialize() {
      initialization ||= connect().then((value) => { client = value; }).catch((error) => { initialization = null; throw error; });
      await initialization;
      return this.current();
    },
    async current() {
      if (!client) return { enabled: false, user: null };
      return { enabled: true, user: identity((await read())?.user) };
    },
    async headers() {
      const session = await read();
      return session ? { authorization: `Bearer ${session.access_token}` } : {};
    },
    async refresh() {
      if (!client) return null;
      refreshing ||= client.auth.refreshSession().then(({ data, error }) => {
        if (error) throw authError(error);
        return data.session;
      }).finally(() => { refreshing = null; });
      return refreshing;
    },
    async request(url, options = {}) {
      const expectedUser = options.headers?.['x-aimers-user'];
      const checkAccount = async () => {
        if (client && expectedUser && (await read())?.user.id !== expectedUser) {
          throw Object.assign(new Error('로그인 계정이 변경됐어요. 변경 내용을 내보낸 뒤 다시 열어 주세요.'), { status: 401 });
        }
      };
      await checkAccount();
      const headers = await this.headers();
      const response = await fetcher(url, { ...options, headers: { ...options.headers, ...headers } });
      if (response.status !== 401 || !client) return response;
      const session = await read();
      if (!session) return response;
      // A 401 is returned before API side effects. Refresh once and replay the same body.
      if (`Bearer ${session.access_token}` === headers.authorization) await this.refresh();
      await checkAccount();
      return fetcher(url, { ...options, headers: { ...options.headers, ...await this.headers() } });
    },
    async signIn() {
      if (!client) throw new Error('Google 로그인을 사용할 수 없어요.');
      const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/`, queryParams: { prompt: 'select_account' } } });
      if (error) throw error;
    },
    async signOut() {
      if (!client) return;
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
    },
  };
}

export const sessionManager = createSessionManager();
