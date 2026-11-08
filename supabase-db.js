import { userClient } from './auth.js';
import { defaultProfile, validateState } from './state.js';
import { todayStr } from './public/logic.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('입력 내용을 확인해 주세요.');
  return value.trim();
};
const uuid = (value) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail('그룹 또는 사용자 ID가 올바르지 않습니다.');
  return value;
};

export class SupabaseStore {
  constructor(client, user) { this.client = client; this.user = user; }
  async rpc(name, args) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) {
      const known = {
        AUTH_REQUIRED: [401, '로그인해 주세요.'], STATE_CONFLICT: [409, '다른 기기에서 수정한 내용이 있어요. 변경 내용을 내보낸 뒤 새로고침해 주세요.'],
        NOT_MEMBER: [403, '그룹에 접근할 수 없습니다.'], NOT_FOUND: [404, '초대 코드를 확인해 주세요.'],
        GROUP_LIMIT: [400, '참여 가능한 그룹 또는 멤버 수를 초과했습니다.'],
        POKE_UNAVAILABLE: [400, '현재 기록을 독촉할 수 없는 멤버입니다.'], INVALID_INPUT: [400, '입력 내용을 확인해 주세요.'],
      };
      const code = Object.keys(known).find((key) => error.message?.includes(key));
      if (code) fail(known[code][1], known[code][0]);
      if (error.code === '23514') fail('저장 형식이나 데이터 크기를 확인해 주세요.');
      throw Object.assign(new Error('DB 요청을 처리하지 못했어요. 연결과 마이그레이션 적용 상태를 확인해 주세요.'), { cause: error });
    }
    return data;
  }
  own(userId) { if (userId !== this.user.id) fail('다른 계정에 접근할 수 없습니다.', 403); }
  state(userId) {
    this.own(userId);
    const name = this.user.user_metadata?.full_name || this.user.name || this.user.email?.split('@')[0] || '나';
    return this.rpc('app_state', { p_today: todayStr(), p_default: {
      v: 1, profile: defaultProfile(name), categories: ['프로젝트', '대외활동', '동아리', '전공공부'],
      entries: [], groups: [], lastNotified: '',
    } });
  }
  async saveState(userId, state, revision) {
    this.own(userId);
    const valid = validateState(state);
    if (!Number.isSafeInteger(revision) || revision < 0) fail('저장 버전이 올바르지 않습니다.');
    return { revision: await this.rpc('save_user_state', { p_state: { v: 1, ...valid, groups: [] }, p_revision: revision }) };
  }
  createGroup(userId, name) { this.own(userId); return this.group('create', { name: text(name, 20) }); }
  joinGroup(userId, code) { this.own(userId); return this.group('join', { code: text(code, 20).toUpperCase() }); }
  leaveGroup(userId, groupId) { this.own(userId); return this.group('leave', { groupId: uuid(groupId) }); }
  poke(userId, groupId, recipientId) { this.own(userId); return this.group('poke', { groupId: uuid(groupId), recipientId: uuid(recipientId), today: todayStr() }); }
  readNotifications(userId) { this.own(userId); return this.group('read', {}); }
  group(action, payload) { return this.rpc('app_group_action', { p_action: action, p_payload: payload }); }
  async saveAiRun(userId, task, input, result) {
    this.own(userId);
    await this.rpc('app_ai_history', { p_run: { task, input, result } });
  }
  aiHistory(userId) { this.own(userId); return this.rpc('app_ai_history', { p_run: null }); }
}

export const getStore = (req, user) => new SupabaseStore(userClient(req), user);
