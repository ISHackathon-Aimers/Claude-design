import { todayStr } from './public/logic.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max, required = false) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('입력 내용을 확인해 주세요.');
  return value;
};
const day = (value, optional = false) => {
  if (optional && value === '') return value;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('날짜를 확인해 주세요.');
  return value;
};
export function defaultProfile(name = '나') {
  return { name: name.slice(0, 20), bio: '', photo: '', public: false, periodDays: 7,
    startDate: todayStr(), notify: false, theme: 'system', fontScale: 100 };
}

export function validateState(s) {
  if (!s || s.v !== 1 || !s.profile || !Array.isArray(s.categories) || !Array.isArray(s.entries)) fail('저장 형식이 올바르지 않습니다.');
  const p = s.profile;
  const profile = { name: text(p.name, 20, true), bio: text(p.bio, 40), photo: text(p.photo, 500000),
    public: p.public, periodDays: p.periodDays, startDate: day(p.startDate), notify: p.notify, theme: p.theme, fontScale: p.fontScale };
  if (typeof p.public !== 'boolean' || typeof p.notify !== 'boolean' || ![7, 14, 30].includes(p.periodDays) ||
      !['system', 'light', 'dark'].includes(p.theme) || ![90, 100, 110, 120, 130].includes(p.fontScale)) fail('프로필 설정이 올바르지 않습니다.');
  if (p.photo && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.photo)) fail('프로필 사진 형식이 올바르지 않습니다.');
  if (!s.categories.length || s.categories.length > 100 || s.entries.length > 10000) fail('저장 가능한 개수를 초과했습니다.');
  const categories = s.categories.map((c) => text(c, 15, true));
  if (new Set(categories).size !== categories.length) fail('카테고리가 중복되었습니다.');
  const ids = new Set();
  const entries = s.entries.map((e) => {
    if (!e || typeof e !== 'object') fail('기록 형식이 올바르지 않습니다.');
    const id = text(e.id, 80, true);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) fail('기록 ID가 올바르지 않습니다.');
    ids.add(id);
    if (!categories.includes(e.category)) fail('기록의 카테고리를 확인해 주세요.');
    if (!Array.isArray(e.tags) || e.tags.length > 30 || !Array.isArray(e.qa) || e.qa.length > 30) fail('기록 형식이 올바르지 않습니다.');
    return { id, date: day(e.date), category: e.category, title: text(e.title, 200, true), summary: text(e.summary, 20000, true),
      raw: text(e.raw, 50000), tags: e.tags.map((v) => text(v, 100)),
      qa: e.qa.map((v) => {
        if (!v || typeof v !== 'object') fail('질문과 답변 형식이 올바르지 않습니다.');
        return { q: text(v.q, 2000), a: text(v.a, 10000) };
      }) };
  });
  return { profile, categories, entries, lastNotified: day(s.lastNotified || '', true) };
}
