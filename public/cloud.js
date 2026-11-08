import { createClient } from '@supabase/supabase-js';
import { createPersistentStorage } from './auth-storage.js';

let connection;
export function connectCloud() {
  connection ||= createConnection().catch((error) => { connection = null; throw error; });
  return connection;
}

async function createConnection() {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('서비스 연결 설정을 불러오지 못했어요.');
  const config = await response.json();
  if (!config.enabled) return null;
  const storage = await createPersistentStorage();
  return createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storage },
  });
}
