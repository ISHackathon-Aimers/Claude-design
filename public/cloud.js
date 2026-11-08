import { createClient } from '@supabase/supabase-js';

export async function connectCloud() {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('서비스 연결 설정을 불러오지 못했어요.');
  const config = await response.json();
  if (!config.enabled) return null;
  return createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
}
