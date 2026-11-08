import { connectCloud } from './cloud.bundle.js';

let client;
const identity = (user) => user ? {
  id: user.id, email: user.email || '',
  name: user.user_metadata?.full_name || user.email?.split('@')[0] || '나',
  googleSub: user.identities?.find((i) => i.provider === 'google')?.identity_data?.sub || user.user_metadata?.sub,
} : null;

// This adapter keeps main's UI and API contracts while using Supabase sessions.
export const sessionManager = {
  async initialize() { client = await connectCloud(); return this.current(); },
  async current() {
    if (!client) return { enabled: false, user: null };
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return { enabled: true, user: identity(data.session?.user) };
  },
  async headers() {
    if (!client) return {};
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session ? { authorization: `Bearer ${data.session.access_token}` } : {};
  },
  async signIn() {
    if (!client) throw new Error('Google 로그인을 사용할 수 없어요.');
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/`, queryParams: { prompt: 'select_account' } } });
    if (error) throw error;
  },
  async signOut() {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw error;
  },
};
