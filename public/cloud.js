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

export async function readState(client, userId) {
  const { data, error } = await client.from('user_states').select('state, revision').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('저장한 기록을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
  return data;
}

export async function writeState(client, state, revision) {
  const { data, error } = await client.rpc('save_user_state', { p_state: state, p_revision: revision });
  if (error) {
    const conflict = error.message?.includes('STATE_CONFLICT');
    throw Object.assign(new Error(conflict
      ? '다른 기기에서 기록이 변경됐어요. 백업 후 최신 기록을 불러와 주세요.'
      : '서버에 저장하지 못했어요. 이 기기의 임시 기록을 보관하고 있어요.'), { conflict });
  }
  return data;
}
