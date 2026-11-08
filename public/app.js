import { todayStr, periodIndex, periodRange, streakInfo, daysLeft, semesterOf, fireLevel, fromDay, toDay, weekday, matchEntry } from './logic.js';
import { sessionManager } from './session.js';
import { pwa } from './pwa.js';
import { createSaveFeedback, loadingMarkup } from './feedback.js';
pwa.listen();

// 로그인 사용자의 영구 데이터는 서버 DB에 저장한다. 게스트 시연 데이터는 메모리에서만 사용한다.
const KEY = 'aimers-v1';
const auth = { loading: true, enabled: false, user: null, error: '', busy: false, restoreError: false };
const sync = { ready: false, revision: 0, generation: 0, pending: null, saving: null, error: '', conflict: false };
let legacyState = null;
let aiRuns = [];
const $ = (s, el = document) => el.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 10);
const ago = (n) => fromDay(toDay(todayStr()) - n);
const fmt = (d) => { const [y, m, dd] = d.split('-'); return `${y}.${m}.${dd}`; };
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const fmtW = (d) => `${fmt(d)} (${DAYS[weekday(d)]})`;
const fmtMD = (d) => `${d.slice(5, 7)}.${d.slice(8)} (${DAYS[weekday(d)]})`;
const fmtLong = (d) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일 ${DAYS[weekday(d)]}요일`;
const dayClass = (d) => ({ 0: ' sun', 6: ' sat' })[weekday(d)] || '';

const ICONS = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  trend: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  dots: '<circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/>',
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  sparkle: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
};
const icon = (n, s = 20) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const spinner = '<span class="spinner" aria-hidden="true"></span>';
const saveFeedback = createSaveFeedback($('#save-status'));

// ───────── 시연 데이터 ─────────
function seed() {
  const start = ago(60 * 7); // 주 1회 기록, 오늘이 61번째 기간의 첫날
  const e = (d, category, title, raw, summary, tags, qa = []) => ({ id: uid(), date: ago(d), category, title, raw, summary, tags, qa });
  const rich = [
    e(410, '프로젝트', '웹프로그래밍 조별과제', '웹프로그래밍 수업 조별과제로 학과 행사 소개 페이지를 만들었다. 나는 HTML/CSS로 메인 화면을 맡았다.',
      '웹프로그래밍 조별과제에서 메인 화면을 맡았고, 코드 충돌을 줄이려고 공통 작성 규칙을 정리해 팀에 공유했습니다.', ['협업', '전공 역량'],
      [{ q: '진행하면서 가장 어려웠던 점은 무엇이었나요?', a: '팀원마다 코드 스타일이 달라서 합칠 때 충돌이 많았다. 내가 공통 규칙을 문서로 정리해 공유했다.' }]),
    e(380, '동아리', '코딩 동아리 첫 활동', '코딩 동아리에 들어가서 처음으로 파이썬 스터디에 참여했다. 매주 과제를 제출했다.',
      '코딩 동아리에 가입해 처음으로 파이썬 스터디에 참여했고, 매주 과제를 빠짐없이 제출했습니다.', ['도전', '성실성']),
    e(300, '전공공부', '겨울방학 SQL 공부', '겨울방학 동안 SQL 기초 강의를 듣고 매일 문제 3개씩 풀었다. 총 120문제 정도 풀었다.',
      '겨울방학 동안 SQL 강의를 듣고 매일 3문제씩, 약 120문제를 풀며 기초를 다졌습니다.', ['성실성', '전공 역량']),
    e(230, '대외활동', '교내 데이터 분석 공모전 참가', '교내 데이터 분석 공모전에 4명이 한 팀으로 나갔다. 내가 팀장을 맡아 일정과 역할을 나눴다.',
      '4인 팀의 팀장으로 교내 데이터 분석 공모전에 참가해 일정 관리와 역할 분담을 맡았습니다.', ['리더십', '협업']),
    e(200, '프로젝트', '공모전 데이터 전처리', '공모전 데이터에 결측치가 30% 정도 있었다. 평균 대체 대신 비슷한 그룹의 값으로 채우는 방법을 찾아 적용했다.',
      '결측치가 약 30%인 데이터를 비슷한 그룹의 값으로 채우는 방식으로 처리해 분석 정확도를 높였습니다.', ['문제 해결', '전공 역량']),
    e(170, '대외활동', '공모전 장려상 수상', '공모전 본선 발표를 내가 맡았다. 심사위원 질문에 데이터 근거로 답했고 장려상을 받았다.',
      '공모전 본선 발표를 맡아 심사위원 질문에 데이터 근거로 답했고, 팀이 장려상을 받았습니다.', ['커뮤니케이션']),
    e(140, '전공공부', '데이터베이스 기말 프로젝트', '데이터베이스 수업 기말 프로젝트로 동아리 관리 DB를 설계했다. ERD를 그리고 3정규형까지 정규화했다.',
      '동아리 관리 데이터베이스를 설계하며 ERD 작성과 3정규형 정규화를 직접 수행했습니다.', ['전공 역량']),
    e(110, '대외활동', '여름방학 IT 서포터즈', '여름방학에 IT 기업 서포터즈로 활동하며 새 기능 소개 콘텐츠를 3개 만들었다. 처음 해 보는 홍보 일이었다.',
      'IT 기업 서포터즈로 새 기능 소개 콘텐츠 3개를 제작하며 처음으로 홍보 업무를 경험했습니다.', ['도전', '커뮤니케이션']),
    e(84, '동아리', '동아리 알고리즘 스터디 운영', '동아리에서 6명 알고리즘 스터디를 운영했다. 진도 의견이 갈려서 수준별로 문제를 나누는 방식으로 조율했다.',
      '6명 알고리즘 스터디를 운영하며 진도에 대한 의견 차이를 수준별 문제 배분으로 조율했습니다.', ['리더십', '갈등 조율']),
    e(63, '프로젝트', '해커톤 팀 결성', '학과 해커톤에 나가려고 팀을 꾸렸다. 아이디어 회의를 3번 하면서 경험 기록 서비스로 주제를 정했다.',
      '학과 해커톤 팀을 꾸리고 세 차례 아이디어 회의를 거쳐 경험 기록 서비스로 주제를 정했습니다.', ['협업']),
  ];
  const study = ['운영체제 프로세스 스케줄링', '자료구조 트리 순회 과제', '데이터베이스 인덱스', '통계학 가설검정', '파이썬 크롤링 실습',
    '네트워크 TCP 연결 과정', '정보처리기사 필기 기출 2회분', '알고리즘 BFS 문제 10개', '웹 접근성 기초', '시스템 분석 설계 UML'];
  // 최근 12주 연속 기록(9·12주 전은 위의 기록으로 채워짐)
  const fillers = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11].map((w, i) =>
    e(w * 7 - 2, '전공공부', study[i], `${study[i]}을(를) 공부했다. 수업 내용을 복습하고 노트에 정리했다.`,
      `${study[i]}을(를) 공부하고 핵심 개념을 노트에 정리했습니다.`, ['전공 역량']));
  // 멤버마다 기록 주기(days)와 시작일이 다르다. 완료 여부는 각자의 이번 기간에 마지막 기록(lastAgo일 전)이 들어 있는지로 정해진다.
  const member = (name, color, isPublic, { days, startAgo, lastAgo }, streak, entries) => ({
    id: uid(), name, color, public: isPublic, periodDays: days, startDate: ago(startAgo),
    lastEntryDate: ago(lastAgo), streak, entries: entries.map(([d, category, title, summary]) => ({ id: uid(), date: ago(d), category, title, summary, tags: [] })),
  });
  return {
    v: 1,
    profile: { name: '김에이머', bio: '정보시스템학과 3학년', photo: '', public: true, periodDays: 7, startDate: start, notify: false, theme: 'system', fontScale: 100 },
    categories: ['프로젝트', '대외활동', '동아리', '전공공부'],
    entries: [...rich, ...fillers].sort((a, b) => b.date.localeCompare(a.date)),
    groups: [
      {
        id: uid(), name: '정보시스템학과 24학번', code: 'IS24AM',
        members: [
          member('이지민', '#7c3aed', true, { days: 7, startAgo: 420, lastAgo: 0 }, 15, [[0, '대외활동', '교내 홍보단 면접', '교내 홍보단 면접을 보고 자기소개를 준비했습니다.'], [9, '전공공부', '경영정보시스템 중간고사', 'ERP 개념을 정리하며 중간고사를 준비했습니다.']]),
          member('박서연', '#0891b2', true, { days: 14, startAgo: 424, lastAgo: 6 }, 4, [[6, '프로젝트', '앱 프로젝트 UI 설계', '팀 앱 프로젝트에서 피그마로 화면 6개를 설계했습니다.']]),
          member('최도윤', '#ca8a04', true, { days: 7, startAgo: 423, lastAgo: 1 }, 22, [[1, '대외활동', '빅데이터 교육 수료', '8주 빅데이터 교육을 수료하고 미니 프로젝트를 발표했습니다.'], [8, '동아리', '밴드 동아리 공연', '공연 기획에서 무대 순서 조율을 맡았습니다.']]),
          member('정하준', '#16a34a', false, { days: 30, startAgo: 445, lastAgo: 30 }, 0, [[30, '전공공부', '회계원리 복습', '회계원리 분개를 복습했습니다.']]),
          member('한유나', '#db2777', true, { days: 7, startAgo: 426, lastAgo: 8 }, 8, [[8, '대외활동', '봉사활동 기획', '지역아동센터 코딩 교실 커리큘럼을 짰습니다.']]),
        ],
      },
      {
        id: uid(), name: '데이터 공모전 팀', code: 'DATA4U',
        members: [
          member('이지민', '#7c3aed', true, { days: 7, startAgo: 420, lastAgo: 0 }, 15, [[0, '대외활동', '교내 홍보단 면접', '교내 홍보단 면접을 보고 자기소개를 준비했습니다.']]),
          member('오세훈', '#ea580c', true, { days: 14, startAgo: 430, lastAgo: 12 }, 2, [[12, '프로젝트', '시각화 대시보드', '공모전 결과를 대시보드로 만들었습니다.']]),
        ],
      },
    ],
    pokes: {},
    lastNotified: '',
  };
}

function initialState() {
  const s = seed();
  if (auth.user) {
    s.profile.name = auth.user.name.slice(0, 20);
    s.profile.bio = '';
    s.profile.startDate = todayStr();
    s.profile.public = false;
    s.entries = [];
    s.groups = [];
  }
  return s;
}
async function api(url, { method = 'GET', body } = {}) {
  const res = await sessionManager.request(url, { method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'AIMers', 'x-aimers-user': auth.user?.id || '' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await res.json().catch(() => ({ error: '서버 응답을 읽지 못했어요.' }));
  if (!res.ok) throw Object.assign(new Error(data.error || '요청에 실패했어요.'), { status: res.status });
  return data;
}

function renderSync() {
  if (sync.saving) saveFeedback.update('saving');
  else if (sync.error) saveFeedback.update(sync.conflict ? 'conflict' : 'error', sync.error);
  else if (sync.pending) saveFeedback.update('saving');
  else saveFeedback.update('idle');
}

function save() {
  if (!auth.user) return Promise.resolve(true);
  if (!sync.ready) return Promise.resolve(false);
  sync.generation++;
  sync.pending = JSON.parse(JSON.stringify({ v: S.v, profile: S.profile, entries: S.entries, categories: S.categories, lastNotified: S.lastNotified }));
  return flushSave();
}

function flushSave() {
  if (sync.saving) return sync.saving;
  if (sync.conflict) return Promise.resolve(false);
  sync.saving = (async () => {
    while (sync.pending) {
      const snapshot = sync.pending;
      sync.pending = null;
      try {
        const result = await api('/api/state', { method: 'PUT', body: { revision: sync.revision, state: snapshot } });
        sync.revision = result.revision;
        sync.error = '';
      } catch (e) {
        sync.pending ||= snapshot;
        sync.conflict = e.status === 409;
        sync.error = e.status === 401 ? '로그인이 만료되어 저장하지 못했어요. 변경 내용을 내보낸 뒤 다시 로그인해 주세요.'
          : e.message || '저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
        return false;
      }
    }
    return true;
  })().finally(() => { sync.saving = null; renderSync(); });
  renderSync();
  return sync.saving;
}

async function refreshData() {
  if (sync.pending || sync.saving) { if (!await flushSave()) throw new Error('저장하지 못한 변경 내용을 먼저 확인해 주세요.'); }
  const generation = sync.generation;
  const data = await api('/api/state');
  if (generation === sync.generation && data.revision >= sync.revision && !sync.pending && !sync.saving) {
    S = data.state; sync.revision = data.revision;
  } else {
    S.groups = data.state.groups; S.pokes = data.state.pokes; S.notifications = data.state.notifications;
  }
  sync.ready = true;
  renderSync();
}

let S = seed();
const ui = {
  cat: 'all', q: '', date: '', day: '', demo: false, newGroup: false,
  rec: null,
  interview: { theme: '', questions: [], active: -1, answer: '', feedback: null, loading: '' },
  match: { prompt: '', results: null, loading: false },
  insight: { data: null, loading: false },
};

// ───────── 공통 ─────────
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

async function ai(task, input) {
  if (!auth.user) throw new Error('AI 기능을 사용하려면 Google로 로그인해 주세요.');
  let res;
  try {
    res = await sessionManager.request('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'AIMers', 'x-aimers-user': auth.user.id }, body: JSON.stringify({ task, input }) });
  } catch {
    throw new Error('서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
  }
  const body = await res.json().catch(() => ({ error: '서버 응답을 읽지 못했어요.' }));
  if (!res.ok || body.error) throw new Error(body.error || '요청에 실패했어요.');
  if (body.demo && !ui.demo) { ui.demo = true; renderTop(); }
  if (body.note) toast(body.note);
  try { aiRuns = (await api('/api/ai/history')).runs; } catch { /* AI 결과는 전달하고 활동 목록은 다음 로드에서 다시 읽는다. */ }
  return body.data;
}

const brief = (e) => ({ id: e.id, title: e.title, summary: e.summary, category: e.category, date: e.date, tags: e.tags });

function myStats() {
  const p = S.profile;
  const today = todayStr();
  const info = streakInfo(S.entries.map((e) => e.date), p.startDate, p.periodDays, today);
  const [ps, pe] = periodRange(Math.max(info.current, 0), p.startDate, p.periodDays);
  return { ...info, ps, pe, left: info.current < 0 ? 0 : daysLeft(today, p.startDate, p.periodDays) };
}
// 그룹 규칙: 멤버마다 자기 작성 주기·시작일로 '이번 기간'을 따로 계산한다. 그 기간에 기록이 없으면 미작성(콕 찌르기 대상).
const PERIOD_NAMES = { 7: '매주', 14: '2주마다', 30: '한 달마다' };
const periodName = (d) => PERIOD_NAMES[d] || `${d}일마다`;
function memberStatus(m) {
  if (m.me) { const s = myStats(); return { done: s.doneNow, streak: s.streak, left: s.left, days: S.profile.periodDays }; }
  const today = todayStr();
  const days = m.periodDays || 7;
  const left = m.startDate ? daysLeft(today, m.startDate, days) : null;
  if (typeof m.doneNow === 'boolean') return { done: m.doneNow, streak: m.streak, left, days }; // 실제 멤버: 서버가 각자 기간으로 계산
  const cur = periodIndex(today, m.startDate, days);
  return { done: periodIndex(m.lastEntryDate, m.startDate, days) === cur, streak: m.streak, left, days };
}
const me = () => ({ id: 'me', me: true, name: S.profile.name, color: '#e11d48', photo: S.profile.photo, public: S.profile.public });
// 이름 첫 글자: Google 이름 앞에 붙는 보이지 않는 문자(소프트 하이픈 등)는 건너뛴다
const initial = (name = '') => [...name.replace(/[\s\u00ad\u200b-\u200f\u2060\ufeff]/g, '')][0] || '?';
const avatar = (m) => `<span class="avatar" style="background:${esc(m.color)}">${m.photo ? `<img src="${m.photo}" alt="">` : esc(initial(m.name))}</span>`;
// 연속 기록이 10회·20회를 넘으면 프로필에 불꽃 테두리와 연속 횟수 배지가 붙는다
function fireRing(m, streak, cls = '') {
  const lvl = fireLevel(streak);
  const badge = lvl ? `<span class="fire-badge" aria-hidden="true">${icon('flame', 12)}${cls === 'sm' ? '' : streak}</span>` : '';
  return `<span class="ring ${cls} fire-${lvl}">${avatar(m)}${badge}</span>`;
}
const durationText = (periods, len) => {
  const days = periods * len;
  return len % 30 === 0 ? `${periods * (len / 30)}개월` : `${Math.round(days / 7)}주`;
};

function entryCard(e, owner = true, open = false) {
  return `<article class="card entry">
    <div class="entry-meta"><span class="tag-cat">#${esc(e.category)}</span>
      <span class="meta-right"><time datetime="${e.date}">${fmt(e.date)}</time>${owner ? `<span class="entry-menu-wrap">
        <button class="icon-btn kebab" data-act="entry-menu" aria-label="기록 메뉴" aria-haspopup="menu" aria-expanded="false">${icon('dots', 20)}</button>
        <span class="menu" role="menu" hidden>
          <button role="menuitem" data-act="edit-entry" data-v="${e.id}">${icon('edit', 18)} 수정</button>
          <button role="menuitem" class="danger" data-act="del-entry" data-v="${e.id}">${icon('trash', 18)} 삭제</button>
        </span></span>` : ''}</span></div>
    <h3>${esc(e.title)}</h3>
    <p>${esc(e.summary)}</p>
    ${e.tags?.length ? `<ul class="tags" aria-label="역량">${e.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${e.raw ? `<details ${open ? 'open' : ''}><summary>원본 보기</summary><div class="raw">
      <p class="pre">${esc(e.raw)}</p>
      ${(e.qa || []).map((x) => `<p class="qa-q">Q. ${esc(x.q)}</p><p class="pre">${x.a ? esc(x.a) : '<span class="muted">(답변 없음)</span>'}</p>`).join('')}
    </div></details>` : ''}
  </article>`;
}

// ───────── 1번 탭: 내 대시보드 ─────────
// 이번 기간의 날짜 버튼 줄: 날짜를 누르면 그날 쓴 기록을 아래에 보여 준다
function dayStrip(start, len) {
  const today = todayStr();
  const has = new Set(S.entries.map((e) => e.date));
  const days = Array.from({ length: len }, (_, k) => fromDay(toDay(start) + k));
  if (!days.includes(ui.day)) ui.day = days.includes(today) ? today : days[0]; // 기간이 바뀌면 오늘로
  return `<div class="days${len > 7 ? ' scroll' : ''}" role="group" aria-label="날짜를 골라 그날 기록 보기">${days.map((d) => {
    const future = d > today;
    return `<button type="button" class="day${d === today ? ' today' : ''}${has.has(d) ? ' has' : ''}" data-act="pick-day" data-v="${d}" ${future ? 'disabled' : ''}
      aria-pressed="${d === ui.day}" aria-label="${fmtLong(d)}${d === today ? ', 오늘' : ''}${has.has(d) ? ', 기록 있음' : ''}">
      <span class="dw${dayClass(d)}">${DAYS[weekday(d)]}</span><span class="dn">${Number(d.slice(8))}</span><span class="dot" aria-hidden="true"></span></button>`;
  }).join('')}</div>${dayRecords(ui.day)}`;
}

// 고른 날짜에 쓴 기록 목록
function dayRecords(d) {
  const list = S.entries.filter((e) => e.date === d);
  const label = d === todayStr() ? `오늘(${fmtLong(d)})` : fmtLong(d);
  return `<div class="day-panel" aria-live="polite">
    <strong class="day-title">${label} 기록 ${list.length}개</strong>
    ${list.length
      ? `<ul class="mini-list day-list${list.length === 1 ? ' single' : ''}">${list.map((e) => `<li><a class="mini-row" href="#/entry/${e.id}">
          <span class="mini-main"><span class="tag-cat">#${esc(e.category)}</span><strong>${esc(e.title)}</strong></span>${icon('next', 18)}</a></li>`).join('')}</ul>`
      : '<p class="day-empty muted">이 날은 아직 기록이 없어요.<br>아래 버튼으로 기록해 보세요.</p>'}
  </div>`;
}

function dashboard() {
  const s = myStats();
  const p = S.profile;
  const status = s.current < 0
    ? `<section class="card"><p>${fmt(p.startDate)}부터 첫 기록 기간이 시작돼요.</p><button class="btn secondary block" data-act="record">${icon('plus')} 미리 기록하기</button></section>`
    : `<section class="card status ${s.doneNow ? 'done' : ''}" aria-label="이번 기록 기간">
      <div class="status-top"><span class="eyebrow">이번 기록 기간 · ${s.ps.slice(0, 4)}년</span><span class="dday">${s.doneNow ? '완료' : `D-${s.left}`}</span></div>
      <p class="range">${fmtMD(s.ps)} ~ ${fmtMD(s.pe)}</p>
      ${dayStrip(s.ps, p.periodDays)}
      ${s.doneNow
        ? `<p class="ok">${icon('check', 18)} 이번 기간 기록을 마쳤어요. 남길 경험이 더 있다면 추가해도 좋아요.</p>`
        : s.left <= 2
          ? `<p class="warn">${icon('bell', 18)} 기록 마감까지 ${s.left === 0 ? '오늘 하루' : `${s.left}일`} 남았어요.</p>`
          : '<p class="muted">이번 기간에 한 일을 남겨 주세요. 적을 게 없다면 그 주에 한 전공 공부도 좋아요.</p>'}
      <button class="btn ${s.doneNow ? 'secondary' : 'primary'} block" data-act="day-record" data-v="${ui.day}">${icon('plus')} ${ui.day === todayStr() ? (s.doneNow ? '오늘 기록 추가하기' : '이번 기간 경험 기록하기') : `${fmtLong(ui.day).replace(/ \S+요일$/, '')} 기록 추가하기`}</button>
    </section>`;

  const first = S.entries.map((e) => e.date).sort()[0];
  const spanDays = first ? toDay(todayStr()) - toDay(first) : 0;
  const span = spanDays >= 60 ? `${Math.floor(spanDays / 30)}개월` : `${Math.max(1, Math.ceil(spanDays / 7))}주`;
  const head = (title, href) => `<div class="list-head"><h2>${title}</h2><a class="more" href="${href}">전체 보기 ${icon('next', 16)}</a></div>`;

  // 나의 기록 미리보기: 최근 3개
  const recent = [...S.entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const recordsBox = `<section class="card">${head('나의 기록', '#/records')}
    ${recent.length ? `<ul class="mini-list">${recent.map((e) => `<li><a class="mini-row" href="#/entry/${e.id}">
      <span class="mini-main"><span class="tag-cat">#${esc(e.category)}</span><strong>${esc(e.title)}</strong></span>
      <time datetime="${e.date}">${fmtMD(e.date)}</time></a></li>`).join('')}</ul>` : '<p class="muted">아직 기록이 없어요. 첫 한 걸음을 남겨 보세요.</p>'}
  </section>`;

  // AIMers+ 미리보기: 가장 많이 쌓인 역량 한 줄 + 바로 가기
  const counts = axisCounts(S.entries);
  const topAxis = AXES[counts.indexOf(Math.max(...counts))];
  const tile = (href, ic, label) => `<a class="tile" href="${href}"><span class="nav-ic">${icon(ic, 22)}</span><span>${label}</span></a>`;
  const servicesBox = `<section class="card">${head('AIMers+', '#/services')}
    ${S.entries.length ? `<p class="help">지금까지 가장 많이 쌓인 역량은 <strong class="hl">${topAxis.key}</strong>이에요.</p>` : ''}
    <div class="tiles">${tile('#/services/interview', 'chat', '면접 예상 질문')}${tile('#/services/match', 'search', '자소서 경험 검색')}${tile('#/services/insight', 'trend', '성장 인사이트')}</div>
  </section>`;

  // 내 그룹 미리보기: 그룹별 이번 기간 작성 현황
  const groupsBox = `<section class="card">${head('내 그룹', '#/groups')}
    ${S.groups.length ? `<ul class="mini-list">${S.groups.map((g) => {
      const ms = groupMembers(g);
      const late = ms.filter((m) => !memberStatus(m).done).length;
      return `<li><a class="mini-row" href="#/groups/${g.id}"><span class="mini-main"><strong>${esc(g.name)}</strong>
        <small>이번 기간 ${ms.length - late}/${ms.length}명 기록</small></span>
        ${late ? `<span class="late-badge">미작성 ${late}명</span>` : `<span class="ok-badge">${icon('check', 14)} 모두 완료</span>`}</a></li>`;
    }).join('')}</ul>` : '<p class="muted">아직 속한 그룹이 없어요.</p>'}
  </section>`;

  return {
    html: `${status}
    <section class="stats" aria-label="기록 통계">
      <div><strong>${S.entries.length}회</strong><span>총 기록</span></div>
      <div><strong>${span}</strong><span>기록한 기간</span></div>
      <div><strong>${s.streak}회</strong><span>연속 기록</span></div>
    </section>
    ${recordsBox}${servicesBox}${groupsBox}`,
  };
}

// ───────── 2번 탭: 내 기록 ─────────
function records() {
  const cats = [...new Set([...S.categories, ...S.entries.map((e) => e.category)])];
  return {
    html: `<div class="list-head"><p class="lead">총 ${S.entries.length}개의 경험을 기록했어요.</p>
      <button class="btn small primary" data-act="record">${icon('plus', 18)} 기록하기</button></div>
    <div class="search-row">
      <label class="search" for="rec-q">${icon('search', 18)}<span class="sr-only">기록 검색</span>
        <input id="rec-q" type="search" data-search placeholder="내용 또는 날짜(11.08)로 검색" value="${esc(ui.q)}" autocomplete="off" enterkeyhint="search"></label>
      <button class="icon-btn date-pick${ui.date ? ' on' : ''}" data-act="rec-date" aria-label="달력에서 날짜로 찾기">${icon('calendar', 20)}</button>
    </div>
    ${ui.date ? `<div><button class="chip on" data-act="rec-date-clear" aria-label="${fmtLong(ui.date)} 조건 지우기">${icon('calendar', 14)} ${fmtW(ui.date)} ${icon('x', 14)}</button></div>` : ''}
    <div class="chips" role="group" aria-label="카테고리 필터">
      ${['all', ...cats].map((c) => `<button class="chip" data-act="cat" data-v="${esc(c)}" aria-pressed="${ui.cat === c}">${c === 'all' ? '전체' : `#${esc(c)}`}</button>`).join('')}
    </div>
    <p class="result-line" id="rec-count" aria-live="polite"></p>
    <div id="rec-list" class="rec-list"></div>`,
  };
}

// 검색어를 칠 때마다 목록 부분만 다시 그려서 입력 칸의 포커스가 유지되게 한다
function updateRecords() {
  const list = $('#rec-list');
  if (!list) return;
  const shown = S.entries
    .filter((e) => (ui.cat === 'all' || e.category === ui.cat) && (!ui.date || e.date === ui.date) && matchEntry(e, ui.q))
    .sort((a, b) => b.date.localeCompare(a.date));
  const label = [ui.cat === 'all' ? '전체' : `#${ui.cat}`, ui.date && fmtW(ui.date), ui.q.trim() && `'${ui.q.trim()}' 검색`].filter(Boolean).join(' · ');
  $('#rec-count').innerHTML = `${esc(label)} <strong>${shown.length}개</strong>`;
  const filtered = ui.q.trim() || ui.date;
  list.innerHTML = !S.entries.length
    ? '<div class="empty"><p>아직 기록이 없어요.<br>첫 한 걸음을 남겨 보세요.</p></div>'
    : shown.length
      ? shown.map((e) => entryCard(e)).join('')
      : `<div class="empty"><p>${filtered ? '조건에 맞는 기록이 없어요.' : '이 카테고리의 기록이 없어요.'}</p>${filtered ? '<button class="btn small secondary" data-act="rec-clear">검색 조건 지우기</button>' : ''}</div>`;
}

// 기록 하나를 크게 보기 (추천 경험·대시보드에서 눌러 들어온다)
function entryView(id) {
  const e = S.entries.find((x) => x.id === id);
  return {
    title: '기록 보기', back: 'history',
    html: e ? entryCard(e, true, true) : '<p class="empty">기록을 찾을 수 없어요. 삭제되었을 수 있어요.</p>',
  };
}

// ───────── 기록 작성 시트 ─────────
function openRecord(date = todayStr()) {
  ui.rec = { step: 'write', category: S.categories[0] || '기타', date, raw: '', questions: [], answers: [], draft: null, loading: false, error: '' };
  renderSheet();
  $('#sheet').showModal();
}
// 카테고리(＋추가)와 날짜 입력: 새 기록 작성과 기록 수정에서 함께 쓴다
function catDateFields(r) {
  return `<fieldset><legend>카테고리</legend>
        <div class="chips wrap">${S.categories.map((c) => `<button type="button" class="chip" data-act="rec-cat" data-v="${esc(c)}" aria-pressed="${r.category === c}">#${esc(c)}</button>`).join('')}
          <button type="button" class="chip add-chip" data-act="rec-add-cat" aria-label="카테고리 추가" aria-expanded="${!!r.addingCat}">${icon('plus', 16)}</button></div>
        ${r.addingCat ? `<form class="inline add-cat-form" data-form="add-cat"><label class="sr-only" for="new-cat">새 카테고리 이름</label><input id="new-cat" name="label" maxlength="15" placeholder="새 카테고리 (예: 인턴)" autocomplete="off">
          <button class="btn small primary">추가</button><button type="button" class="btn small secondary" data-act="rec-add-cat">취소</button></form>` : ''}
      </fieldset>
      <div class="field"><span class="label" id="rec-date-l">날짜</span>
        <button type="button" class="date-btn" data-act="cal-rec" aria-labelledby="rec-date-l rec-date-v">${icon('calendar')}<span id="rec-date-v">${fmtW(r.date)}</span></button></div>`;
}

const editSnapshot = (r) => JSON.stringify([r.category, r.date, r.draft.title, r.draft.summary, r.raw]);
function openEdit(id) {
  const e = S.entries.find((x) => x.id === id);
  if (!e) return;
  ui.rec = { step: 'edit', id, category: e.category, date: e.date, raw: e.raw || '', draft: { title: e.title, summary: e.summary }, loading: false, error: '' };
  ui.rec.orig = editSnapshot(ui.rec);
  renderSheet();
  $('#sheet').showModal();
}

function renderSheet() {
  const r = ui.rec;
  if (!r) return;
  const head = (title) => `<header class="sheet-head"><h2 id="sheet-title">${title}</h2><button class="icon-btn" data-act="close-sheet" aria-label="닫기">${icon('x', 22)}</button></header>`;
  const err = r.error ? `<p class="error" role="alert">${esc(r.error)}</p>` : '';
  const busy = (label) => (r.loading ? `${spinner} ${label}` : '');
  let body;
  let foot;
  if (r.step === 'edit') {
    body = `${catDateFields(r)}
      <div class="field"><label for="e-title">제목</label><input id="e-title" maxlength="60" data-model="rec.draft.title" value="${esc(r.draft.title)}"></div>
      <div class="field"><label for="e-summary">요약</label><textarea id="e-summary" rows="4" maxlength="600" data-model="rec.draft.summary">${esc(r.draft.summary)}</textarea></div>
      <div class="field"><label for="e-raw">원문</label><textarea id="e-raw" rows="5" maxlength="4000" data-model="rec.raw">${esc(r.raw)}</textarea>
        <p class="help">원문을 고쳐도 AI 요약은 다시 만들지 않아요. 요약도 함께 고쳐 주세요.</p></div>${err}`;
    foot = `<button class="btn secondary" data-act="close-sheet" ${r.loading ? 'disabled' : ''}>취소</button>
      <button class="btn primary" data-act="edit-save" aria-busy="${r.loading}" ${r.loading ? 'disabled' : ''}>${r.loading ? `${spinner} 저장하고 있어요` : `${icon('check')} 수정 완료`}</button>`;
  } else if (r.step === 'write') {
    body = `<p class="step">1 / 3 · 경험 쓰기</p>
${catDateFields(r)}
      <div class="field"><label for="rec-raw">이번 기간에 한 일</label>
        <textarea id="rec-raw" rows="6" maxlength="4000" data-model="rec.raw" placeholder="예: 팀 프로젝트에서 회원가입 화면을 만들었어요.">${esc(r.raw)}</textarea>
        <p class="help">짧게 써도 괜찮아요. 부족한 부분은 AI가 질문으로 채워 드려요.</p></div>${err}`;
    foot = `<button class="btn primary" data-act="rec-next" aria-busy="${r.loading}" ${r.loading ? 'disabled' : ''}>${busy('경험을 살펴보고 있어요') || '다음'}</button>`;
  } else if (r.step === 'ask') {
    body = `<p class="step">2 / 3 · AI 꼬리질문</p>
      <p class="help">조금만 더 알려 주시면 나중에 자소서와 면접에 바로 쓸 수 있어요. 기억나지 않는 질문은 비워 두셔도 돼요.</p>
      ${r.questions.map((q, i) => `<div class="field"><label class="ai-q" for="qa-${i}">${esc(q)}</label><textarea id="qa-${i}" rows="3" maxlength="1000" data-model="rec.answers.${i}">${esc(r.answers[i] || '')}</textarea></div>`).join('')}${err}`;
    foot = `<button class="btn secondary" data-act="rec-back" ${r.loading ? 'disabled' : ''}>이전</button>
      <button class="btn primary" data-act="rec-summarize" aria-busy="${r.loading}" ${r.loading ? 'disabled' : ''}>${busy('정리하고 있어요') || 'AI로 정리하기'}</button>`;
  } else {
    const d = r.draft;
    body = `<p class="step">3 / 3 · 정리 확인</p>
      <p class="help">AI가 정리한 내용이에요. 틀린 곳은 직접 고칠 수 있고, 원문은 그대로 함께 저장돼요.</p>
      <div class="field"><label for="d-title">제목</label><input id="d-title" maxlength="60" data-model="rec.draft.title" value="${esc(d.title)}"></div>
      <div class="field"><label for="d-summary">요약</label><textarea id="d-summary" rows="5" maxlength="600" data-model="rec.draft.summary">${esc(d.summary)}</textarea></div>
      ${d.tags.length ? `<div class="field"><span class="eyebrow">드러난 역량</span><ul class="tags">${d.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}${err}`;
    foot = `<button class="btn secondary" data-act="rec-back" ${r.loading ? 'disabled' : ''}>이전</button><button class="btn primary" data-act="rec-save" aria-busy="${r.loading}" ${r.loading ? 'disabled' : ''}>${r.loading ? `${spinner} 저장하고 있어요` : `${icon('check')} 저장하기`}</button>`;
  }
  $('#sheet').innerHTML = `${head(r.step === 'edit' ? '기록 수정하기' : '경험 기록하기')}<div class="sheet-body">${body}</div><footer class="sheet-foot">${foot}</footer>`;
}

async function summarize() {
  const r = ui.rec;
  r.loading = true; r.error = ''; renderSheet();
  try {
    const qa = r.questions.map((q, i) => ({ q, a: (r.answers[i] || '').trim() }));
    r.draft = await ai('summarize', { raw: r.raw, category: r.category, qa });
    r.step = 'review';
  } catch (e) { r.error = e.message; }
  r.loading = false; renderSheet();
}

// ───────── 4번 탭: AIMers+ (기록을 활용하는 AI 서비스) ─────────
const needEntries = () => (S.entries.length ? '' : `<div class="card empty"><p>먼저 경험을 기록해 주세요.</p><a class="btn primary" href="#/dashboard">기록하러 가기</a></div>`);

function services() {
  const n = S.entries.length;
  const counts = axisCounts(S.entries);
  const top = n ? AXES[counts.indexOf(Math.max(...counts))].key : '';
  const svc = (href, ic, title, desc, steps, stat) => `<a class="card svc" href="${href}">
    <span class="svc-head"><span class="nav-ic">${icon(ic, 24)}</span><strong>${title}</strong>${icon('next')}</span>
    <span class="svc-desc">${desc}</span>
    <ol class="svc-steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    ${stat ? `<span class="svc-stat">${stat}</span>` : ''}</a>`;
  return {
    html: `<section class="card plus-hero">
      <span class="eyebrow">AIMers+</span>
      <h2>쌓아 둔 기록을 취업 준비로</h2>
      <p class="muted">지금까지 기록한 ${n}개의 경험을 AI가 읽고, 면접 연습과 자기소개서, 성장 정리에 바로 쓸 수 있게 도와줘요. 모든 결과는 내 기록에 적힌 내용만 근거로 해요.</p>
    </section>
    ${svc('#/services/interview', 'chat', '면접 예상 질문',
      '내 기록을 바탕으로 실제 면접관이 물어볼 만한 질문을 만들어요. 답변을 쓰면 잘한 점과 보완할 점을 알려 줘요.',
      ['카테고리나 역량 고르기', '질문을 골라 답변 쓰기', 'AI 피드백 확인하기'], n ? `연습할 수 있는 기록 ${n}개` : '')}
    ${svc('#/services/match', 'search', '자소서 문항 관련 경험 검색',
      '자기소개서 문항을 붙여 넣으면 쓰기 좋은 경험을 기록 속 실제 문장과 함께 찾아 줘요. 기록에 없는 내용은 지어내지 않아요.',
      ['문항 붙여 넣기', '추천 경험과 근거 문장 확인', '눌러서 기록 전체 보기'], n ? `검색할 수 있는 기록 ${n}개` : '')}
    ${svc('#/services/insight', 'trend', '성장 인사이트',
      '학기별로 어떤 활동을 했는지 정리하고, 역량 육각형으로 어떤 능력이 자랐는지 한눈에 보여 줘요.',
      ['역량 육각형 보기', '학기별 연대기 살펴보기', 'AI 성장 보고서 받기'], top ? `가장 많이 쌓인 역량: ${top}` : '')}`,
  };
}

function themes() {
  const cats = [...new Set(S.entries.map((e) => e.category))].map((c) => ({ key: `c:${c}`, label: `#${c}` }));
  const tags = [...new Set(S.entries.flatMap((e) => e.tags || []))].map((t) => ({ key: `t:${t}`, label: t }));
  return { cats, tags };
}
const entriesFor = (key) => S.entries.filter((e) => (key.startsWith('c:') ? e.category === key.slice(2) : (e.tags || []).includes(key.slice(2))));

function interview() {
  const iv = ui.interview;
  const { cats, tags } = themes();
  const chip = (t) => `<button class="chip" data-act="iv-theme" data-v="${esc(t.key)}" aria-pressed="${iv.theme === t.key}">${esc(t.label)}</button>`;
  const q = iv.questions[iv.active];
  const src = q && S.entries.find((e) => e.id === q.entry_id);
  const fb = iv.feedback;
  return {
    title: '면접 예상 질문', back: '#/services',
    html: needEntries() || `<section class="card">
      <h2>어떤 항목으로 연습할까요?</h2>
      <p class="help">AI가 항목별로 정리한 기록에서 면접 질문을 만들어요.</p>
      <span class="group-label">카테고리</span><div class="chips wrap">${cats.map(chip).join('')}</div>
      ${tags.length ? `<span class="group-label">역량</span><div class="chips wrap">${tags.map(chip).join('')}</div>` : ''}
      <button class="btn primary block" data-act="iv-make" aria-busy="${iv.loading === 'q'}" ${!iv.theme || iv.loading ? 'disabled' : ''}>${iv.loading === 'q' ? `${spinner} 질문을 준비하고 있어요` : `${icon('sparkle')} 질문 만들기`}</button>
    </section>
    ${iv.questions.length ? `<section style="display:grid;gap:8px"><h2>예상 질문</h2><ul class="q-list">${iv.questions.map((x, i) => {
      const e = S.entries.find((en) => en.id === x.entry_id);
      return `<li><button class="q-btn" data-act="iv-pick" data-v="${i}" aria-pressed="${iv.active === i}"><span>${esc(x.question)}</span>${e ? `<small>근거: ${esc(e.title)} · ${fmt(e.date)}</small>` : ''}</button></li>`;
    }).join('')}</ul></section>` : ''}
    ${q ? `<section class="card">
      <h2>답변 연습</h2><p class="ai-q">${esc(q.question)}</p>
      ${src ? `<details><summary>내 기록 다시 보기</summary><div class="raw"><p><strong>${esc(src.title)}</strong></p><p>${esc(src.summary)}</p></div></details>` : ''}
      <div class="field"><label for="iv-answer">내 답변</label><textarea id="iv-answer" rows="6" maxlength="3000" data-model="interview.answer" placeholder="실제 면접처럼 말하듯이 써 보세요.">${esc(iv.answer)}</textarea></div>
      <button class="btn primary block" data-act="iv-eval" aria-busy="${iv.loading === 'e'}" ${iv.loading ? 'disabled' : ''}>${iv.loading === 'e' ? `${spinner} 답변을 살펴보고 있어요` : '답변 평가 받기'}</button>
    </section>` : ''}
    ${fb ? `<section class="card feedback" aria-live="polite">
      <h2>피드백</h2><p>${esc(fb.overall)}</p>
      ${fb.strengths.length ? `<h3>잘한 점</h3><ul>${fb.strengths.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${fb.improvements.length ? `<h3>보완할 점</h3><ul>${fb.improvements.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${fb.tip ? `<p class="tip">${esc(fb.tip)}</p>` : ''}
      <p class="help">AI 피드백은 참고용이며 합격 여부를 예측하지 않아요.</p>
    </section>` : ''}`,
  };
}

function match() {
  const m = ui.match;
  return {
    title: '자소서 문항 관련 경험 검색', back: '#/services',
    html: needEntries() || `<section class="card">
      <div class="field"><label for="m-prompt">자기소개서 문항</label>
      <textarea id="m-prompt" rows="4" maxlength="500" data-model="match.prompt" placeholder="예: 팀원과 협력하여 어려운 문제를 해결한 경험을 서술하시오.">${esc(m.prompt)}</textarea></div>
      <button class="btn primary block" data-act="m-run" aria-busy="${m.loading}" ${m.loading ? 'disabled' : ''}>${m.loading ? `${spinner} 어울리는 경험을 찾고 있어요` : `${icon('search')} 어울리는 경험 찾기`}</button>
    </section>
    ${m.results ? (m.results.length ? `<h2>추천 경험 ${m.results.length}개</h2>${m.results.map((r, i) => {
      const e = S.entries.find((en) => en.id === r.id);
      return e ? `<a class="card match-card" href="#/entry/${e.id}" aria-label="추천 ${i + 1}: ${esc(e.title)} 기록 보기">
        <span class="eyebrow">추천 ${i + 1} · #${esc(e.category)} · ${fmtW(e.date)}</span><h3>${esc(e.title)}</h3>
        <blockquote class="evidence"><span class="eyebrow">기록 속 근거</span><p>“${esc(r.evidence)}”</p></blockquote>
        ${r.reason ? `<p class="ai-summary"><strong>추천 이유</strong><br>${esc(r.reason)}</p>` : ''}${r.angle ? `<p class="tip">${esc(r.angle)}</p>` : ''}
        <span class="more">기록 전체 보기 ${icon('next', 16)}</span></a>` : '';
    }).join('')}` : '<p class="empty">이 문항에 근거로 쓸 만한 기록을 찾지 못했어요.<br>관련 경험을 먼저 기록하거나 문항을 바꿔 보세요.</p>') : ''}`,
  };
}

function semesters() {
  const map = new Map();
  for (const e of [...S.entries].sort((a, b) => a.date.localeCompare(b.date))) {
    const s = semesterOf(e.date);
    if (!map.has(s.key)) map.set(s.key, { ...s, entries: [] });
    map.get(s.key).entries.push(e);
  }
  return [...map.values()];
}

// 역량 육각형: 기록에 붙은 역량 태그 8개를 6개 축으로 묶는다
const AXES = [
  { key: '전공 역량', tags: ['전공 역량'] },
  { key: '문제 해결', tags: ['문제 해결'] },
  { key: '협업', tags: ['협업', '갈등 조율'] },
  { key: '리더십', tags: ['리더십'] },
  { key: '소통', tags: ['커뮤니케이션'] },
  { key: '자기주도', tags: ['도전', '성실성'] },
];
const axisCounts = (entries) => AXES.map((a) => entries.filter((e) => (e.tags || []).some((t) => a.tags.includes(t))).length);

function radarSvg(now, past) {
  const cx = 170;
  const cy = 150;
  const R = 92;
  const max = Math.max(1, ...now);
  const pt = (i, r) => {
    const a = (-90 + i * 60) * (Math.PI / 180);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const poly = (vals) => vals.map((v, i) => pt(i, (v / max) * R).map((n) => n.toFixed(1)).join(',')).join(' ');
  const rings = [0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${AXES.map((_, i) => pt(i, R * f).join(',')).join(' ')}" class="r-grid"/>`).join('');
  const spokes = AXES.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="r-grid"/>`; }).join('');
  const labels = AXES.map((a, i) => {
    const [x, y] = pt(i, R + 22);
    const anchor = Math.abs(x - cx) < 4 ? 'middle' : x > cx ? 'start' : 'end';
    const dy = y < cy - R ? -4 : y > cy + R ? 12 : 4;
    return `<text x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}" class="r-label">${a.key}<tspan class="r-val"> ${now[i]}</tspan></text>`;
  }).join('');
  const dots = now.map((v, i) => {
    const [x, y] = pt(i, (v / max) * R);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" class="r-dot"><title>${AXES[i].key}: 지금 ${v}개${past ? ` · 지난 학기까지 ${past[i]}개` : ''}</title></circle>`;
  }).join('');
  return `<svg viewBox="0 0 340 300" class="radar" role="img" aria-label="역량 육각형 그래프. ${AXES.map((a, i) => `${a.key} ${now[i]}개`).join(', ')}">
    ${rings}${spokes}
    ${past ? `<polygon points="${poly(past)}" class="r-past"/>` : ''}
    <polygon points="${poly(now)}" class="r-now"/>${dots}${labels}</svg>`;
}

function radarCard(sems) {
  if (!S.entries.length) return '';
  const now = axisCounts(S.entries);
  const before = sems.length > 1 ? S.entries.filter((e) => semesterOf(e.date).key !== sems.at(-1).key) : null;
  const past = before ? axisCounts(before) : null;
  const diff = past ? now.map((v, i) => v - past[i]) : null;
  const best = diff && Math.max(...diff) > 0 ? diff.indexOf(Math.max(...diff)) : -1;
  return `<section class="card">
    <h2>나의 역량 육각형</h2>
    <p class="help">기록마다 붙은 역량을 6가지로 묶어 센 거예요. 바깥으로 넓을수록 그 역량을 보여 주는 경험이 많아요.</p>
    ${best >= 0 ? `<p class="ai-summary">이번 학기에 가장 많이 자란 역량은 <strong>${AXES[best].key}</strong>예요. 경험 ${diff[best]}개가 새로 쌓였어요.</p>` : ''}
    ${past ? `<div class="legend" aria-hidden="true"><span><i class="sw now"></i>지금</span><span><i class="sw past"></i>지난 학기까지</span></div>` : ''}
    ${radarSvg(now, past)}
    <table class="r-table"><caption class="sr-only">역량별 경험 수</caption>
      <thead><tr><th scope="col">역량</th><th scope="col">경험</th>${past ? '<th scope="col">이번 학기</th>' : ''}</tr></thead>
      <tbody>${AXES.map((a, i) => `<tr><th scope="row">${a.key}</th><td>${now[i]}개</td>${past ? `<td class="${diff[i] > 0 ? 'up' : ''}">${diff[i] > 0 ? `+${diff[i]}` : '–'}</td>` : ''}</tr>`).join('')}</tbody>
    </table>
  </section>`;
}

function insight() {
  const sems = semesters();
  const max = Math.max(1, ...sems.map((s) => s.entries.length));
  const d = ui.insight.data;
  const count = (arr) => Object.entries(arr.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  return {
    title: '성장 인사이트', back: '#/services',
    html: needEntries() || `${radarCard(sems)}<section class="card"><h2>나의 대학생활 연대기</h2>
      <p class="help">${sems.length}개 학기 동안 ${S.entries.length}개의 경험을 기록했어요.</p>
      <button class="btn primary block" data-act="ins-run" aria-busy="${ui.insight.loading}" ${ui.insight.loading ? 'disabled' : ''}>${ui.insight.loading ? `${spinner} 성장 보고서를 준비하고 있어요` : `${icon('sparkle')} AI 성장 보고서 받기`}</button></section>
    ${d ? `<section class="card" aria-live="polite"><h2>달라진 점</h2><ul style="margin:0;padding-left:20px;display:grid;gap:6px">${d.growth.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>${d.next_step ? `<p class="tip">${esc(d.next_step)}</p>` : ''}</section>` : ''}
    <div class="timeline">${sems.slice().reverse().map((s) => {
      const tags = count(s.entries.flatMap((e) => e.tags || [])).slice(0, 3);
      const cats = count(s.entries.map((e) => e.category));
      const sum = d?.semesters.find((x) => x.label === s.label);
      return `<article class="card">
        <div class="status-top"><h3>${s.label}</h3><span class="eyebrow">${s.entries.length}개 기록</span></div>
        <div class="sem-bar" role="img" aria-label="기록 ${s.entries.length}개"><span style="width:${(s.entries.length / max) * 100}%"></span></div>
        ${sum ? `<p class="ai-summary">${esc(sum.summary)}</p>` : ''}
        <p class="help">${cats.map(([c, n]) => `#${esc(c)} ${n}`).join(' · ')}</p>
        ${tags.length ? `<ul class="tags">${tags.map(([t]) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <details><summary>활동 목록 보기</summary><div class="raw">${s.entries.map((e) => `<p>${fmt(e.date)} · ${esc(e.title)}</p>`).join('')}</div></details>
      </article>`;
    }).join('')}</div>`,
  };
}

// ───────── 3번 탭: 내 그룹 ─────────
const pokeKey = (g, m) => `${g.id}:${m.id}:${periodIndex(todayStr(), m.startDate, m.periodDays)}`;
function groupMembers(g) { return [me(), ...g.members]; }

function groups() {
  return {
    html: `<p class="lead">친구들과 함께 기록하면 포기하지 않고 이어 갈 수 있어요.</p>
    ${S.notifications?.length ? `<section class="card"><h2>받은 알림</h2>${S.notifications.map((n) => `<p>${esc(n.senderName)}님이 ${esc(n.groupName)} 그룹에서 기록을 기다리고 있어요.</p>`).join('')}
      <button class="btn secondary" data-act="read-notifications">알림 읽음 처리</button></section>` : ''}
    ${S.groups.map((g) => {
      const ms = groupMembers(g);
      const done = ms.filter((m) => memberStatus(m).done).length;
      return `<a class="card group-card" href="#/groups/${g.id}">
        <span class="stack" aria-hidden="true">${ms.slice(0, 3).map(avatar).join('')}</span>
        <span><strong>${esc(g.name)}</strong><small>${ms.length}명 · 이번 기간 ${done}/${ms.length}명 기록</small></span>${icon('next')}</a>`;
    }).join('') || '<p class="empty">아직 속한 그룹이 없어요.</p>'}
    ${ui.newGroup
      ? `<form class="card" data-form="new-group"><div class="field"><label for="g-name">그룹 이름</label><input id="g-name" name="label" maxlength="20" required placeholder="예: 24학번 동기들" autocomplete="off"></div>
        <div class="inline"><button type="button" class="btn secondary" data-act="cancel-group">취소</button><button class="btn primary" style="flex:1">만들기</button></div></form>`
      : `<button class="btn secondary block" data-act="new-group">${icon('plus')} 새 그룹 만들기</button>`}
    ${auth.user ? '<form class="card" data-form="join-group"><div class="field"><label for="invite-code">그룹 초대 코드</label><input id="invite-code" name="code" maxlength="20" required autocomplete="off"></div><button class="btn secondary">그룹 참여하기</button></form>' : ''}`,
  };
}

function groupDetail(g) {
  const ms = groupMembers(g);
  const done = ms.filter((m) => memberStatus(m).done).length;
  return {
    title: g.name, back: '#/groups',
    html: `<section class="card">
      <div class="group-head"><span class="eyebrow">각자의 이번 기록 기간</span><button class="chip" data-act="copy" data-v="${esc(g.code)}">${icon('copy', 16)} 초대 코드 ${esc(g.code)}</button></div>
      <p><strong>${ms.length}명 중 ${done}명</strong>이 자기 기간의 기록을 마쳤어요.</p>
      <div class="bar" role="img" aria-label="${ms.length}명 중 ${done}명 완료"><span style="width:${(done / ms.length) * 100}%"></span></div>
      <p class="help">멤버마다 기록 주기와 시작일이 달라요. 자기 기간 안에 아직 기록하지 않은 멤버만 콕 찌를 수 있어요.</p>
      <p class="help">${auth.user ? '친구에게 초대 코드를 공유하면 같은 그룹에 참여할 수 있어요.' : '시연용 그룹입니다.'}</p>
      ${auth.user ? `<button class="btn secondary" data-act="leave-group" data-v="${g.id}">그룹 나가기</button>` : ''}
    </section>
    <section class="card"><h2>멤버</h2><ul class="members">${ms.map((m) => {
      const st = memberStatus(m);
      const poked = !m.me && S.pokes[pokeKey(g, m)];
      return `<li class="member">
        <a class="member-link" href="${m.me ? '#/profile' : `#/groups/${g.id}/m/${m.id}`}">
          ${fireRing(m, st.streak)}
          <span class="m-info"><strong>${esc(m.name)}${m.me ? ' (나)' : ''}${m.public ? '' : ` ${icon('lock', 14)}`}</strong>
          <small>${periodName(st.days)} 기록 · <span class="${st.done ? 'done-txt' : 'late'}">${st.done ? '완료' : `미작성${st.left == null ? '' : st.left === 0 ? ' · 오늘 마감' : ` · 마감 D-${st.left}`}`}</span></small></span>
        </a>
        ${st.done ? '' : '<span class="alert-dot" role="img" aria-label="미작성">!</span>'}
        ${!st.done && !m.me ? `<button class="btn small ${poked ? 'secondary' : 'primary'}" data-act="poke" data-g="${g.id}" data-v="${m.id}" ${poked ? 'disabled' : ''}>${poked ? '찔렀어요' : '콕 찌르기'}</button>` : ''}
      </li>`;
    }).join('')}</ul></section>`,
  };
}

function memberView(g, m) {
  const st = memberStatus(m);
  return {
    title: m.name, back: `#/groups/${g.id}`,
    html: `<section class="profile-top">
      ${fireRing(m, st.streak)}
      <h2>${esc(m.name)}</h2><p class="muted">연속 ${st.streak}회 기록 · ${esc(g.name)}</p>
      ${fireLevel(st.streak) ? `<span class="flame-note">${icon('flame', 18)} 프로필이 불타는 중</span>` : ''}
    </section>
    ${m.public
      ? (m.entries.length ? m.entries.map((e) => entryCard(e, false)).join('') : '<p class="empty">아직 공개된 기록이 없어요.</p>')
      : `<section class="card lock">${icon('lock', 28)}<p><strong>비공개 계정이에요</strong><br>${esc(m.name)}님이 기록을 비공개로 설정했어요.</p></section>`}`,
  };
}

// ───────── 4번 탭: 개인 프로필 ─────────
function accountCard() {
  return `<section class="card account-card" aria-labelledby="account-title">
    <h2 id="account-title">Google 계정</h2>
    ${auth.user ? `<p><strong>${esc(auth.user.name)}</strong></p><p class="account-email">${esc(auth.user.email)}</p>
      <p class="help">기록과 설정을 서버에 저장해요. 같은 계정으로 로그인하면 다른 기기에서도 불러올 수 있어요.</p>
      ${legacyState ? `<button class="btn secondary block" data-act="import-legacy">이 브라우저의 이전 기록 ${legacyState.entries?.length || 0}개 가져오기</button>` : ''}
      <button class="btn secondary block" data-act="export-data">내 데이터 내보내기</button>
      <button class="btn secondary block" data-act="logout" ${auth.busy ? 'disabled' : ''}>${auth.busy ? '로그아웃 중...' : '로그아웃'}</button>`
      : `<p class="help">Google 계정으로 로그인하면 기록과 설정을 서버에 저장해요.</p>
      ${auth.enabled ? `<button class="btn secondary block google-login" data-act="login" ${auth.busy ? 'disabled' : ''}>Google로 로그인</button>`
        : '<p class="help">Google 로그인을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.</p>'}`}
    <p class="error" role="alert">${esc(auth.error)}</p>
    ${auth.user && aiRuns.length ? `<details><summary>저장된 AI 활동 ${aiRuns.length}개</summary>${aiRuns.map((run) => `<details><summary>${esc(run.task)} (${esc(new Date(run.createdAt).toLocaleDateString('ko-KR'))})</summary><pre class="ai-history">${esc(JSON.stringify(run.result.data, null, 2))}</pre></details>`).join('')}</details>` : ''}
  </section>`;
}

function pwaCard() {
  const status = pwa.state;
  const installHelp = pwa.isIOS() && !pwa.installed()
    ? '<p class="help">아이폰과 아이패드는 Safari의 공유 메뉴에서 홈 화면에 추가한 뒤, 추가된 AIMers 앱을 열어 알림을 켜 주세요. iOS 16.4 이상이 필요해요.</p>'
    : !pwa.installed() ? '<p class="help">브라우저의 앱 설치 또는 홈 화면에 추가 메뉴로 AIMers를 설치할 수 있어요.</p>' : '<p class="help">AIMers 앱으로 실행 중이에요.</p>';
  return `<section class="card" aria-labelledby="pwa-title"><h2 id="pwa-title">앱 설치와 알림</h2>${installHelp}
    ${status.installable ? '<button class="btn secondary" data-act="pwa-install">AIMers 앱 설치</button>' : ''}
    <p class="help">앱을 닫아도 기록 마감과 그룹 친구의 콕 찌르기 알림을 받을 수 있어요. 알림은 기기마다 켜야 해요.</p>
    ${auth.user ? `<p role="status">${!status.ready ? '알림 설정 확인 중...' : status.subscribed ? '이 기기에서 알림을 받고 있어요.' : !status.available ? '홈 화면 설치 여부와 브라우저 지원, 알림 서버 설정을 확인해 주세요.' : '이 기기의 알림이 꺼져 있어요.'}</p>
      <button class="btn ${status.subscribed ? 'secondary' : 'primary'}" data-act="${status.subscribed ? 'push-disable' : 'push-enable'}" ${status.busy || !status.ready || !status.available ? 'disabled' : ''} aria-busy="${status.busy}">${status.busy ? '설정 중...' : status.subscribed ? '이 기기 알림 끄기' : '이 기기에서 알림 받기'}</button>
      <label class="switch-row" for="push-pokes"><span>콕 찌르기 알림<small>그룹 친구가 내 기록을 기다릴 때 알려 드려요.</small></span><input type="checkbox" role="switch" id="push-pokes" data-push="pokes" ${status.pokes ? 'checked' : ''} ${!status.subscribed || status.busy ? 'disabled' : ''}></label>`
      : '<p class="help">로그인한 뒤 알림을 설정할 수 있어요.</p>'}
    ${status.error ? `<p class="error" role="alert">${esc(status.error)}</p>` : ''}</section>`;
}

function profile() {
  const p = S.profile;
  const s = myStats();
  const lvl = fireLevel(s.streak);
  return {
    title: '개인 프로필', back: 'history',
    html: `${accountCard()}${pwaCard()}<section class="profile-top">
      ${fireRing(me(), s.streak)}
      <label class="btn small secondary" for="pf-photo">${icon('camera', 18)} 사진 변경</label>
      <input type="file" id="pf-photo" accept="image/*" class="sr-only" data-pf="photo">
      ${lvl ? `<span class="flame-note">${icon('flame', 18)} ${lvl === 2 ? '20회 연속! 프로필이 활활 불타요' : '10회 연속! 프로필이 불타기 시작했어요'}</span>` : ''}
    </section>
    <section class="card">
      <div class="field"><label for="pf-name">이름</label><input id="pf-name" maxlength="20" data-pf="name" value="${esc(p.name)}"></div>
      <div class="field"><label for="pf-bio">소개</label><input id="pf-bio" maxlength="40" data-pf="bio" value="${esc(p.bio)}"></div>
    </section>
    <section class="card" aria-label="연속 기록">
      <div class="streak-big">${icon('flame', 28)} ${s.streak}회 연속</div>
      <p>${s.streak ? `${durationText(s.streak, p.periodDays)} 동안 한 번도 빠지지 않고 기록했어요.` : '이번 기간부터 연속 기록을 시작해 보세요.'}</p>
      <p class="help">최고 기록 ${s.best}회 · 기록한 기간 총 ${s.completed}회</p>
      ${lvl < 2 ? `<p class="help">${lvl ? 20 - s.streak : 10 - s.streak}회 더 연속으로 기록하면 프로필이 ${lvl ? '더 크게' : ''} 불타요.</p>` : ''}
    </section>
    <section class="card"><h2>기록 설정</h2>
      <label class="switch-row" for="pf-public"><span>기록 공개<small>그룹 친구가 내 기록을 볼 수 있어요</small></span><input type="checkbox" role="switch" id="pf-public" data-pf="public" ${p.public ? 'checked' : ''}></label>
      <div class="field"><span class="label" id="period-l">작성 기간</span>
        <div class="seg full" role="group" aria-labelledby="period-l">${[7, 14, 30].map((v) => `<button data-act="period" data-v="${v}" aria-pressed="${p.periodDays === v}">${periodName(v)}</button>`).join('')}</div>
        <p class="help">${periodName(p.periodDays)} 한 번씩 기록해요. 이번 기간: ${fmtMD(s.ps)} ~ ${fmtMD(s.pe)}</p></div>
      <div class="field"><span class="label" id="pf-start-l">시작 날짜</span>
        <button type="button" class="date-btn" data-act="cal-start" aria-labelledby="pf-start-l pf-start-v">${icon('calendar')}<span id="pf-start-v">${fmtW(p.startDate)}</span></button></div>
      <label class="switch-row" for="pf-notify"><span>기록 마감 알림<small>미작성 상태라면 마감 2일 전부터 하루 한 번 알려 드려요. 한국 시간 오전 9시대에 발송해요.</small></span><input type="checkbox" role="switch" id="pf-notify" data-pf="notify" ${p.notify ? 'checked' : ''} ${pwa.state.subscribed ? '' : 'disabled'}></label>
    </section>
    <section class="card"><h2>카테고리</h2>
      <p class="help">카테고리를 삭제해도 기록은 지워지지 않고 다른 카테고리로 옮겨져요.</p>
      <ul class="cat-list">${S.categories.map((c) => `<li><span>#${esc(c)}</span><small>${S.entries.filter((e) => e.category === c).length}개</small>
        <button class="icon-btn" data-act="del-cat" data-v="${esc(c)}" aria-label="${esc(c)} 카테고리 삭제" ${S.categories.length <= 1 ? 'disabled' : ''}>${icon('trash', 18)}</button></li>`).join('')}</ul>
      <form class="inline" data-form="add-cat"><label class="sr-only" for="new-cat-p">새 카테고리 이름</label><input id="new-cat-p" name="label" maxlength="15" placeholder="새 카테고리 (예: 인턴)" autocomplete="off"><button class="btn small secondary">추가</button></form>
    </section>
    <section class="card"><h2>화면 설정</h2>
      <div class="field"><span class="label" id="theme-l">화면 모드</span>
        <div class="seg full" role="group" aria-labelledby="theme-l">${[['system', '시스템 설정'], ['light', '라이트'], ['dark', '다크']].map(([v, l]) => `<button data-act="theme" data-v="${v}" aria-pressed="${(p.theme || 'system') === v}">${l}</button>`).join('')}</div></div>
    </section>
    <button class="btn secondary block" data-act="reset">${auth.user ? '기록과 설정 초기화' : '시연 데이터로 초기화'}</button>`,
  };
}

function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const side = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('이미지를 읽지 못했어요.'));
    img.src = URL.createObjectURL(file);
  });
}

function applyPrefs() {
  const root = document.documentElement;
  const theme = S.profile.theme || 'system';
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
}

// 예전 버전에서 쓰던 기록은 프로필 항목이 지금과 다르다(화면 모드 없음, 글꼴·글자 크기 있음).
// 서버가 받는 항목만 골라 담고, 없거나 잘못된 값은 현재 설정으로 채운다.
function legacyProfile(old, cur) {
  const pick = (v, ok, fallback) => (ok(v) ? v : fallback);
  const isText = (v) => typeof v === 'string';
  return {
    name: pick(old.name, (v) => isText(v) && v.trim(), cur.name).slice(0, 20),
    bio: pick(old.bio, isText, cur.bio || '').slice(0, 40),
    photo: pick(old.photo, (v) => isText(v) && (!v || /^data:image\/(jpeg|png|webp);base64,/.test(v)), cur.photo || ''),
    public: cur.public, // 공개 설정은 현재 계정 설정 유지
    periodDays: pick(old.periodDays, (v) => [7, 14, 30].includes(v), cur.periodDays),
    startDate: pick(old.startDate, (v) => isText(v) && /^\d{4}-\d{2}-\d{2}$/.test(v), cur.startDate),
    notify: pick(old.notify, (v) => typeof v === 'boolean', cur.notify),
    theme: pick(old.theme, (v) => ['system', 'light', 'dark'].includes(v), cur.theme || 'system'),
    fontScale: 100, // 글자 크기 설정은 없앴으므로 기본 크기
  };
}

// ───────── 확인창 ─────────
// 브라우저 기본 confirm()은 앱 안 브라우저·웹뷰에서 막혀 바로 '취소'가 되므로 직접 만든 창을 쓴다
function ask(message, okLabel = '확인', danger = false) {
  const d = $('#ask');
  d.innerHTML = `<form method="dialog"><p id="ask-msg" class="pre">${esc(message)}</p>
    <div class="ask-foot"><button class="btn secondary" value="no">취소</button><button class="btn ${danger ? 'danger' : 'primary'}" value="ok">${esc(okLabel)}</button></div></form>`;
  d.returnValue = '';
  d.showModal();
  d.querySelector('[value="no"]').focus();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
}

async function closeSheet() {
  if (ui.rec?.loading) { toast('처리 중이에요. 완료될 때까지 기다려 주세요.'); return; }
  const dirty = ui.rec?.step === 'edit' ? editSnapshot(ui.rec) !== ui.rec.orig : ui.rec?.raw.trim();
  if (dirty && !(await ask(ui.rec.step === 'edit' ? '수정한 내용이 사라져요. 닫을까요?' : '작성 중인 내용이 사라져요. 닫을까요?', '닫기'))) return;
  ui.rec = null;
  $('#sheet').close();
}

// ───────── 달력 (기본 날짜 입력 대신 앱 디자인에 맞춘 달력) ─────────
const cal = { month: '', value: '', max: '', title: '', onPick: null, marks: new Set() };
function openCalendar({ value, max = '', title, onPick }) {
  Object.assign(cal, { value, max, title, onPick, month: value.slice(0, 7), marks: new Set(S.entries.map((e) => e.date)) });
  renderCal();
  $('#cal').showModal();
  $('#cal .cal-day[aria-pressed="true"]')?.focus();
}
function renderCal() {
  const [y, m] = cal.month.split('-').map(Number);
  const first = `${cal.month}-01`;
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = todayStr();
  const blanks = Array.from({ length: weekday(first) }, () => '<span aria-hidden="true"></span>');
  const days = Array.from({ length: len }, (_, k) => {
    const d = fromDay(toDay(first) + k);
    const marked = cal.marks.has(d);
    return `<button type="button" class="cal-day${dayClass(d)}${d === today ? ' today' : ''}${marked ? ' marked' : ''}" data-act="cal-pick" data-v="${d}"
      aria-pressed="${d === cal.value}" aria-label="${y}년 ${fmtLong(d)}${d === today ? ', 오늘' : ''}${marked ? ', 기록 있음' : ''}" ${cal.max && d > cal.max ? 'disabled' : ''}>${k + 1}</button>`;
  });
  $('#cal').innerHTML = `<div class="cal-head"><h2 id="cal-title">${esc(cal.title)}</h2><button class="icon-btn" data-act="cal-close" aria-label="닫기">${icon('x', 22)}</button></div>
    <div class="cal-nav">
      <button class="icon-btn" data-act="cal-move" data-v="-1" aria-label="이전 달">${icon('back', 22)}</button>
      <strong aria-live="polite">${y}년 ${m}월</strong>
      <button class="icon-btn" data-act="cal-move" data-v="1" aria-label="다음 달" ${cal.max && cal.month >= cal.max.slice(0, 7) ? 'disabled' : ''}>${icon('next', 22)}</button>
    </div>
    <div class="cal-grid" role="group" aria-labelledby="cal-title">${DAYS.map((w, i) => `<span class="cal-w${{ 0: ' sun', 6: ' sat' }[i] || ''}" aria-hidden="true">${w}</span>`).join('')}${blanks.join('')}${days.join('')}</div>
    <div class="cal-foot"><span class="help"><span class="mark" aria-hidden="true"></span> 기록한 날</span>
      <button class="btn small secondary" data-act="cal-pick" data-v="${today}" ${cal.max && today > cal.max ? 'disabled' : ''}>오늘</button></div>`;
}

// ───────── 라우팅 & 렌더링 ─────────
const route = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);

function view() {
  const [tab = 'dashboard', a, b, c] = route();
  if (tab === 'services') return { services, interview, match, insight }[a || 'services']?.() || services();
  if (tab === 'groups') {
    const g = S.groups.find((x) => x.id === a);
    if (!g) return groups();
    const m = b === 'm' && g.members.find((x) => x.id === c);
    return m ? memberView(g, m) : groupDetail(g);
  }
  if (tab === 'profile') return profile();
  if (tab === 'records') return records();
  if (tab === 'entry') return entryView(a);
  return dashboard();
}

let current;
function renderTop() {
  const v = current || {};
  const badge = ui.demo ? '<span class="badge" title="AI 키 없이 미리 준비한 답변을 보여 줘요">시연 모드</span>' : '';
  const backBtn = v.back === 'history'
    ? `<button class="icon-btn" data-act="go-back" aria-label="뒤로">${icon('back', 24)}</button>`
    : `<a class="icon-btn" href="${v.back}" aria-label="뒤로">${icon('back', 24)}</a>`;
  // 메인 화면에서는 오른쪽 위 프로필 사진으로 개인 프로필에 들어간다
  const profileBtn = auth.user ? `<a class="top-avatar" href="#/profile" aria-label="개인 프로필">${fireRing(me(), myStats().streak, 'sm')}</a>`
    : '<a class="btn small secondary" href="#/profile">로그인</a>';
  $('#topbar').innerHTML = v.back
    ? `${backBtn}<h1>${esc(v.title)}</h1>${badge}`
    : `<h1 class="logo">AIM<b>ers</b></h1>${badge}${profileBtn}`;
}
// 가로로 넘기는 줄 안에서 el이 가운데 오도록 스크롤한다
function centerIn(box, el) {
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  box.scrollLeft += r.left - b.left - (b.width - r.width) / 2;
}
function render(scroll = false) {
  if (auth.restoreError) return;
  if (auth.loading || (auth.user && !sync.ready)) return;
  current = view();
  renderTop();
  $('#main').innerHTML = current.html;
  $('#main').dataset.view = route()[0] || 'dashboard';
  updateRecords();
  const chips = $('#main .chips');
  const picked = chips && $('[aria-pressed="true"]', chips);
  if (picked) centerIn(chips, picked); // 고른 카테고리가 보이게
  document.querySelectorAll('[data-pf]').forEach((el) => { el.disabled = !auth.user || (el.dataset.pf === 'notify' && !pwa.state.subscribed); });
  const tab = route()[0] || 'dashboard';
  document.querySelectorAll('.tabbar a').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.title = current.title ? `${current.title} · AIMers` : 'AIMers';
  if (scroll) { window.scrollTo(0, 0); $('#main').focus({ preventScroll: true }); }
  const strip = $('.days.scroll');
  const t = strip && $('.day.today', strip);
  if (t) centerIn(strip, t);
}

// ───────── 이벤트 ─────────
const actions = {
  'retry-auth': () => location.reload(),
  'pwa-install': async () => { try { await pwa.install(); } catch { toast('브라우저의 설치 메뉴를 사용해 주세요.'); } },
  'push-enable': async () => {
    if (!auth.user || pwa.state.busy) return;
    pwa.state.busy = true; pwa.state.error = ''; render();
    try {
      await pwa.enable();
      S.profile.notify = true;
      if (!await save()) throw new Error('기기 알림은 켰지만 기록 알림 설정을 저장하지 못했어요. 저장을 재시도해 주세요.');
      toast('이 기기의 알림을 켰어요.');
    } catch (error) { pwa.state.error = error.message; }
    finally { pwa.state.busy = false; render(); }
  },
  'push-disable': async () => {
    if (pwa.state.busy) return;
    pwa.state.busy = true; pwa.state.error = ''; render();
    try { await pwa.disable(); toast('이 기기의 알림을 껐어요.'); }
    catch (error) { pwa.state.error = error.message; }
    finally { pwa.state.busy = false; render(); }
  },
  login: async () => {
    if (auth.busy) return;
    auth.busy = true; auth.error = ''; render();
    try { await sessionManager.signIn(); }
    catch { auth.error = 'Google 로그인에 연결하지 못했어요. 다시 시도해 주세요.'; auth.busy = false; render(); }
  },
  'retry-save': async () => { await flushSave(); },
  'reload-data': async () => {
    if ((sync.pending || sync.saving) && !(await ask('저장하지 못한 변경 내용이 사라져요. 먼저 내보내기로 보관했나요?', '다시 불러오기', true))) return;
    location.reload();
  },
  'export-data': () => {
    const blob = new Blob([JSON.stringify({ user: auth.user, state: S, aiRuns }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `aimers-${todayStr()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  'import-legacy': async () => {
    if (!legacyState || !(await ask('이전 기록과 설정으로 현재 기록과 설정을 교체할까요? 그룹과 공개 설정은 현재 상태를 유지해요.', '가져오기'))) return;
    const entries = (legacyState.entries || []).map((e) => ({ ...e, tags: e.tags || [], qa: e.qa || [] }));
    const categories = [...new Set([...(legacyState.categories || []), ...entries.map((e) => e.category)])];
    S = { ...S, profile: legacyProfile(legacyState.profile || {}, S.profile), entries, categories: categories.length ? categories : S.categories, lastNotified: legacyState.lastNotified || '' };
    if (await save()) { legacyState = null; applyPrefs(); render(); toast('이전 기록을 서버에 저장했어요.'); }
    else render();
  },
  logout: async () => {
    if (auth.busy) return;
    auth.busy = true; auth.error = ''; render();
    try {
      if (!await flushSave()) throw new Error('변경 내용을 먼저 저장해 주세요.');
      await pwa.disable();
      await sessionManager.signOut();
      location.assign('/?auth=logout#/profile');
    } catch (e) {
      auth.error = e.message || '로그아웃하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
      auth.busy = false; render();
    }
  },
  record: () => openRecord(),
  'pick-day': (el) => { ui.day = el.dataset.v; render(); },
  'day-record': (el) => openRecord(el.dataset.v),
  'cal-rec': () => openCalendar({ value: ui.rec.date, max: todayStr(), title: '기록 날짜', onPick: (d) => { ui.rec.date = d; renderSheet(); } }),
  'cal-start': () => openCalendar({ value: S.profile.startDate, title: '기록 시작 날짜', onPick: (d) => { S.profile.startDate = d; save(); render(); toast(`${fmtW(d)}부터 기록 기간을 계산해요.`); } }),
  'cal-move': (el) => {
    const [y, m] = cal.month.split('-').map(Number);
    cal.month = new Date(Date.UTC(y, m - 1 + Number(el.dataset.v), 1)).toISOString().slice(0, 7);
    renderCal();
  },
  'cal-pick': (el) => { $('#cal').close(); cal.onPick?.(el.dataset.v); },
  'cal-close': () => $('#cal').close(),
  theme: (el) => { S.profile.theme = el.dataset.v; save(); applyPrefs(); render(); },
  period: (el) => { S.profile.periodDays = Number(el.dataset.v); save(); render(); toast(`이제 ${periodName(S.profile.periodDays)} 기록해요.`); },
  'del-cat': async (el) => {
    const c = el.dataset.v;
    const n = S.entries.filter((e) => e.category === c).length;
    const rest = S.categories.filter((x) => x !== c);
    const target = c !== '기타' ? '기타' : rest[0];
    if (!rest.length || !(await ask(n ? `'${c}' 카테고리를 삭제할까요?\n이 카테고리의 기록 ${n}개는 '${target}'(으)로 옮겨져요.` : `'${c}' 카테고리를 삭제할까요?`, '삭제', true))) return;
    S.categories = rest;
    if (n) {
      if (!S.categories.includes(target)) S.categories.push(target);
      S.entries.forEach((e) => { if (e.category === c) e.category = target; });
    }
    if (ui.cat === c) ui.cat = 'all';
    save(); render(); toast(`'${c}' 카테고리를 삭제했어요.`);
  },
  'rec-date': () => openCalendar({ value: ui.date || todayStr(), max: todayStr(), title: '날짜로 기록 찾기', onPick: (d) => { ui.date = d; render(); } }),
  'rec-date-clear': () => { ui.date = ''; render(); },
  'rec-clear': () => { ui.q = ''; ui.date = ''; render(); },
  cat: (el) => { ui.cat = el.dataset.v; render(); },
  'del-entry': async (el) => {
    closeMenus();
    if (!(await ask('이 기록을 삭제할까요?\n되돌릴 수 없어요.', '삭제', true))) return;
    S.entries = S.entries.filter((e) => e.id !== el.dataset.v);
    save(); toast('기록을 삭제했어요.');
    if (route()[0] === 'entry') actions['go-back'](); else render();
  },
  'entry-menu': (el) => {
    const menu = el.nextElementSibling;
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
    el.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('[role="menuitem"]').focus();
  },
  'edit-entry': (el) => { closeMenus(); openEdit(el.dataset.v); },
  'edit-save': async () => {
    const r = ui.rec;
    if (r.loading) return;
    if (!r.draft.title.trim() || !r.draft.summary.trim()) { r.error = '제목과 요약을 입력해 주세요.'; renderSheet(); return; }
    const e = S.entries.find((x) => x.id === r.id);
    if (!e) { r.error = '기록을 찾을 수 없어요. 삭제되었을 수 있어요.'; renderSheet(); return; }
    Object.assign(e, { category: r.category, date: r.date, title: r.draft.title.trim(), summary: r.draft.summary.trim(), raw: r.raw.trim() });
    r.loading = true; renderSheet();
    const saved = await save();
    r.loading = false;
    if (!saved) { r.error = '서버에 저장하지 못했어요. 변경 내용은 이 화면에 남아 있어요. 저장 상태를 확인해 주세요.'; renderSheet(); return; }
    ui.rec = null;
    $('#sheet').close();
    ui.insight.data = null;
    toast('기록을 수정했어요.');
    render();
  },
  'go-back': () => { if (history.length > 1) history.back(); else location.hash = '#/dashboard'; },
  'close-sheet': () => closeSheet(),
  'rec-cat': (el) => { ui.rec.category = el.dataset.v; renderSheet(); },
  'rec-add-cat': () => { ui.rec.addingCat = !ui.rec.addingCat; renderSheet(); $('#new-cat')?.focus(); },
  'rec-back': () => { const r = ui.rec; r.error = ''; r.step = r.step === 'review' && r.questions.length ? 'ask' : 'write'; renderSheet(); },
  'rec-next': async () => {
    const r = ui.rec;
    if (!r.raw.trim()) { r.error = '이번 기간에 한 일을 적어 주세요.'; renderSheet(); $('#rec-raw').focus(); return; }
    if (!r.date) { r.error = '날짜를 골라 주세요.'; renderSheet(); return; }
    r.loading = true; r.error = ''; renderSheet();
    try {
      const d = await ai('followup', { raw: r.raw, category: r.category });
      r.questions = d.questions;
      r.answers = d.questions.map((_, i) => r.answers[i] || '');
      r.loading = false;
      if (d.enough) { toast('충분히 구체적이에요. 바로 정리할게요.'); await summarize(); return; }
      r.step = 'ask';
    } catch (e) { r.error = e.message; }
    r.loading = false; renderSheet();
  },
  'rec-summarize': summarize,
  'rec-save': async () => {
    const r = ui.rec;
    if (r.loading) return;
    if (!r.draft.title.trim() || !r.draft.summary.trim()) { r.error = '제목과 요약을 입력해 주세요.'; renderSheet(); return; }
    const before = myStats().streak;
    r.savedId ||= uid();
    S.entries = S.entries.filter((e) => e.id !== r.savedId);
    S.entries.unshift({
      id: r.savedId, date: r.date, category: r.category, title: r.draft.title.trim(), summary: r.draft.summary.trim(),
      raw: r.raw.trim(), qa: r.questions.map((q, i) => ({ q, a: (r.answers[i] || '').trim() })), tags: r.draft.tags,
    });
    r.loading = true; renderSheet();
    const saved = await save();
    r.loading = false;
    if (!saved) { r.error = '서버에 저장하지 못했어요. 변경 내용은 이 화면에 남아 있어요. 저장 상태를 확인해 주세요.'; renderSheet(); return; }
    ui.rec = null;
    $('#sheet').close();
    const after = myStats().streak;
    const lvlUp = fireLevel(after) > fireLevel(before);
    toast(lvlUp ? `${after}회 연속 기록! 프로필이 불타기 시작했어요.` : after > before ? `기록 완료! ${after}회 연속 기록 중이에요.` : '기록을 저장했어요.');
    ui.insight.data = null;
    render();
  },
  'iv-theme': (el) => { ui.interview = { theme: el.dataset.v, questions: [], active: -1, answer: '', feedback: null, loading: '' }; render(); },
  'iv-make': async () => {
    const iv = ui.interview;
    const label = iv.theme.slice(2);
    iv.loading = 'q'; iv.active = -1; iv.feedback = null; render();
    try {
      const d = await ai('questions', { theme: label, entries: entriesFor(iv.theme).slice(0, 15).map(brief) });
      iv.questions = d.questions;
      if (!d.questions.length) toast('질문을 만들지 못했어요. 다시 시도해 주세요.');
    } catch (e) { toast(e.message); }
    iv.loading = ''; render();
  },
  'iv-pick': (el) => { const iv = ui.interview; iv.active = Number(el.dataset.v); iv.answer = ''; iv.feedback = null; render(); $('#iv-answer')?.focus(); },
  'iv-eval': async () => {
    const iv = ui.interview;
    if (!iv.answer.trim()) { toast('답변을 입력해 주세요.'); $('#iv-answer').focus(); return; }
    const q = iv.questions[iv.active];
    const e = S.entries.find((en) => en.id === q.entry_id);
    iv.loading = 'e'; render();
    try { iv.feedback = await ai('evaluate', { question: q.question, answer: iv.answer, entry: e ? brief(e) : null }); } catch (err) { toast(err.message); }
    iv.loading = ''; render();
  },
  'm-run': async () => {
    const m = ui.match;
    if (!m.prompt.trim()) { toast('자기소개서 문항을 입력해 주세요.'); $('#m-prompt').focus(); return; }
    m.loading = true; render();
    // 원문과 꼬리질문 답변까지 보내서 기록 속 문장을 근거로 찾게 한다
    const withDetail = (e) => ({ ...brief(e), detail: [e.raw, ...(e.qa || []).map((x) => x.a)].filter(Boolean).join('\n').slice(0, 800) });
    try { m.results = (await ai('match', { prompt: m.prompt, entries: S.entries.slice(0, 60).map(withDetail) })).matches; } catch (e) { toast(e.message); }
    m.loading = false; render();
  },
  'ins-run': async () => {
    ui.insight.loading = true; render();
    try {
      ui.insight.data = await ai('insight', { semesters: semesters().map((s) => ({ label: s.label, entries: s.entries.slice(-30).map(brief) })) });
    } catch (e) { toast(e.message); }
    ui.insight.loading = false; render();
  },
  'new-group': () => { ui.newGroup = true; render(); $('#g-name').focus(); },
  'cancel-group': () => { ui.newGroup = false; render(); },
  copy: async (el) => {
    try { await navigator.clipboard.writeText(el.dataset.v); toast('초대 코드를 복사했어요.'); } catch { toast(`초대 코드: ${el.dataset.v}`); }
  },
  poke: async (el) => {
    const g = S.groups.find((x) => x.id === el.dataset.g);
    const m = g?.members.find((x) => x.id === el.dataset.v);
    if (!m) return;
    if (auth.user) {
      try {
        await api(`/api/groups/${g.id}/pokes`, { method: 'POST', body: { recipientId: m.id } });
        await refreshData(); render(); toast(`${m.name}님에게 기록 알림을 보냈어요.`);
      } catch (e) { toast(e.message); }
      return;
    }
    S.pokes[pokeKey(g, m)] = todayStr();
    save(); render();
    toast('시연 화면에서 콕 찌르기를 표시했어요.');
  },
  'read-notifications': async () => {
    try { await api('/api/notifications/read', { method: 'POST' }); await refreshData(); render(); } catch (e) { toast(e.message); }
  },
  'leave-group': async (el) => {
    if (!(await ask('이 그룹에서 나갈까요? 다시 참여하려면 초대 코드가 필요해요.', '나가기', true))) return;
    try { await api(`/api/groups/${el.dataset.v}`, { method: 'DELETE' }); await refreshData(); location.hash = '#/groups'; render(); } catch (e) { toast(e.message); }
  },
  reset: async () => {
    if (!(await ask('이 계정의 기록과 설정을 초기화할까요?', '초기화', true))) return;
    const groups = S.groups;
    S = initialState(); if (auth.user) S.groups = groups;
    const saved = await save(); applyPrefs(); ui.insight.data = null; ui.match.results = null;
    ui.interview = { theme: '', questions: [], active: -1, answer: '', feedback: null, loading: '' };
    location.hash = '#/dashboard'; render(true); if (saved) toast('기록과 설정을 초기화했어요.');
  },
};

const forms = {
  'add-cat': (f) => {
    const name = f.elements.label.value.trim().replace(/^#/, '');
    if (!name) return;
    if (!S.categories.includes(name)) { S.categories.push(name); save(); }
    if (ui.rec && $('#sheet').open) { ui.rec.category = name; ui.rec.addingCat = false; renderSheet(); } else { render(); toast(`'${name}' 카테고리를 추가했어요.`); }
  },
  'new-group': async (f) => {
    const name = f.elements.label.value.trim();
    if (!name) return;
    if (auth.user) {
      try {
        const g = await api('/api/groups', { method: 'POST', body: { name } });
        await refreshData(); ui.newGroup = false; location.hash = `#/groups/${g.id}`; render();
        toast('그룹을 만들었어요. 초대 코드를 공유해 주세요.');
      } catch (e) { toast(e.message); }
      return;
    }
    const g = { id: uid(), name, code: Math.random().toString(36).slice(2, 8).toUpperCase(), members: [] };
    S.groups.push(g); ui.newGroup = false; save();
    location.hash = `#/groups/${g.id}`;
    toast('그룹을 만들었어요. 초대 코드를 친구에게 보내 보세요.');
  },
  'join-group': async (f) => {
    try {
      const g = await api('/api/groups/join', { method: 'POST', body: { code: f.elements.code.value.trim() } });
      await refreshData(); location.hash = `#/groups/${g.id}`; render(); toast('그룹에 참여했어요.');
    } catch (e) { toast(e.message); }
  },
};

function setModel(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o?.[k], ui);
  if (target) target[last] = value;
}

async function setPref(el) {
  const p = S.profile;
  const key = el.dataset.pf;
  if (key === 'photo') {
    const file = el.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('이미지 파일을 골라 주세요.'); return; }
    try { p.photo = await resizePhoto(file); } catch (e) { toast(e.message); return; }
  } else if (key === 'public' || key === 'notify') {
    p[key] = el.checked;
  } else if (key === 'periodDays' || key === 'fontScale') {
    p[key] = Number(el.value);
  } else {
    p[key] = el.value.trim() || (key === 'name' ? '나' : '');
  }
  save(); applyPrefs();
  if (key !== 'name' && key !== 'bio') render();
}

function closeMenus() {
  document.querySelectorAll('.entry-menu-wrap .menu:not([hidden])').forEach((m) => { m.hidden = true; m.previousElementSibling.setAttribute('aria-expanded', 'false'); });
}
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenus(); });
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('.entry-menu-wrap')) closeMenus();
  const el = ev.target.closest('[data-act]');
  const writes = ['record', 'edit-entry', 'edit-save', 'day-record', 'period', 'cal-start', 'theme', 'del-cat', 'del-entry', 'rec-save', 'new-group', 'poke', 'reset'];
  if (el && writes.includes(el.dataset.act) && !auth.user) {
    toast('기록을 저장하거나 그룹에 참여하려면 Google로 로그인해 주세요.'); location.hash = '#/profile'; return;
  }
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
});
document.addEventListener('submit', (ev) => {
  const f = ev.target.dataset?.form;
  if (!f) return;
  ev.preventDefault();
  if (!auth.user) { toast('Google로 로그인한 뒤 사용할 수 있어요.'); location.hash = '#/profile'; return; }
  forms[f]?.(ev.target);
});
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.model) setModel(t.dataset.model, t.value);
  if (t.dataset.search !== undefined) { ui.q = t.value; updateRecords(); }
});
document.addEventListener('change', async (ev) => {
  if (ev.target.dataset.pf) setPref(ev.target);
  if (ev.target.dataset.push === 'pokes' && !pwa.state.busy) {
    pwa.state.busy = true; pwa.state.error = '';
    try { await pwa.setPokes(ev.target.checked); }
    catch (error) { pwa.state.error = error.message; }
    finally { pwa.state.busy = false; render(); }
  }
});
$('#cal').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); }); // 바깥을 누르면 닫기
$('#sheet').addEventListener('cancel', (ev) => { ev.preventDefault(); closeSheet(); }); // Esc도 같은 확인을 거친다
window.addEventListener('hashchange', () => render(true));

async function initAuth() {
  $('#topbar').innerHTML = '<h1 class="logo">AIM<b>ers</b></h1>';
  $('#main').innerHTML = loadingMarkup('내 공간을 준비하고 있어요', '로그인 정보를 확인하고 있어요.');
  try {
    const session = await sessionManager.initialize();
    auth.enabled = session.enabled;
    auth.user = session.user;
  } catch (error) {
    if (error.status === 401) {
      auth.loading = false; auth.enabled = true; auth.error = error.message;
      S = seed(); location.hash = '#/profile'; applyPrefs(); render();
      return;
    }
    auth.loading = false; auth.restoreError = true;
    auth.error = error.message || '로그인 상태를 확인하지 못했어요.';
    renderTop();
    $('#main').innerHTML = `<section class="card"><h1>로그인 정보를 복원하지 못했어요</h1><p class="error" role="alert">${esc(auth.error)}</p><p class="help">인터넷 연결과 사이트 데이터 저장 설정을 확인한 뒤 다시 시도해 주세요.</p><button class="btn primary" data-act="retry-auth">다시 연결하기</button></section>`;
    return;
  }
  const url = new URL(location.href);
  const error = url.searchParams.get('auth_error');
  if (error) {
    auth.error = ({
      cancelled: 'Google 로그인을 취소했어요. 다시 로그인할 수 있어요.',
      invalid_state: '로그인 요청이 만료되었어요. 다시 로그인해 주세요.',
      unavailable: 'Google 로그인을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.',
      failed: 'Google 로그인에 실패했어요. 다시 시도해 주세요.',
    })[error] || '로그인하지 못했어요. 다시 시도해 주세요.';
  }
  const success = url.searchParams.get('auth') === 'success';
  url.searchParams.delete('auth'); url.searchParams.delete('auth_error');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  if (auth.user) {
    try {
      $('#main').innerHTML = loadingMarkup('기록을 불러오고 있어요', '지난 경험과 설정을 가져오는 중이에요.');
      await refreshData();
      aiRuns = (await api('/api/ai/history')).runs;
      try {
        const previous = JSON.parse(localStorage.getItem(`${KEY}:google:${auth.user.googleSub}`) || localStorage.getItem(KEY));
        if (previous?.v === 1) legacyState = previous;
      } catch { /* 기존 브라우저 저장소를 읽을 수 없어도 서버 데이터는 사용할 수 있다. */ }
    } catch (e) {
      auth.loading = false; sync.ready = false;
      auth.error = e.message || '서버의 기록을 불러오지 못했어요.';
      $('#main').innerHTML = `${accountCard()}<p class="error" role="alert">기록을 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.</p><button class="btn secondary" data-act="reload-data">다시 불러오기</button>`;
      renderTop(); renderSync(); return;
    }
  } else S = seed();
  auth.loading = false;
  applyPrefs(); render();
  if (success && auth.user) toast(`${auth.user.name}님, 로그인했어요.`);
}

let resumingSession = false;
async function resumeSession() {
  if (auth.loading || auth.restoreError || resumingSession || document.visibilityState === 'hidden') return;
  resumingSession = true;
  try {
    const session = await sessionManager.current();
    if (session.user?.id !== auth.user?.id) {
      if (sync.pending || sync.saving) { sync.error = '로그인 계정이 변경됐어요. 변경 내용을 내보낸 뒤 새로고침해 주세요.'; renderSync(); }
      else location.reload();
    } else if (auth.user && sync.ready && !sync.pending && !sync.saving && !$('#sheet').open && !$('#cal').open) {
      const generation = sync.generation;
      const data = await api('/api/state');
      if (generation === sync.generation && data.revision >= sync.revision && !sync.pending && !sync.saving && !$('#sheet').open && !$('#cal').open) {
        S = data.state; sync.revision = data.revision; applyPrefs(); render();
      }
    }
  } catch { /* Keep the current session and unsaved edits on temporary network errors. */ }
  finally { resumingSession = false; }
}
window.addEventListener('focus', resumeSession);
window.addEventListener('pageshow', resumeSession);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resumeSession(); });
window.addEventListener('online', () => { if (sync.pending && !sync.conflict) flushSave(); });
window.addEventListener('beforeunload', (ev) => {
  if (sync.pending || sync.saving) { ev.preventDefault(); ev.returnValue = ''; }
});

await initAuth();
await pwa.start(api, auth.user, () => { if (route()[0] === 'profile') render(); });
fetch('/api/status').then((r) => r.json()).then((s) => { if (s.demo) { ui.demo = true; renderTop(); } }).catch(() => {});
