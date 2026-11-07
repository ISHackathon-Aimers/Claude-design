import { todayStr, periodIndex, periodRange, streakInfo, daysLeft, semesterOf, fireLevel, fromDay, toDay } from './logic.js';

// shortcut: 기록과 그룹은 이 브라우저(localStorage)에만 저장, 그룹 친구는 시연용 가상 사용자. 실제 서비스 전에 로그인·DB로 교체.
const KEY = 'aimers-v1';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 10);
const ago = (n) => fromDay(toDay(todayStr()) - n);
const fmt = (d) => { const [y, m, dd] = d.split('-'); return `${y}.${m}.${dd}`; };
const FONTS = {
  pretendard: "'Pretendard Variable', Pretendard, -apple-system, 'Apple SD Gothic Neo', sans-serif",
  noto: "'Noto Sans KR', sans-serif",
  gowun: "'Gowun Batang', serif",
};

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
  sparkle: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
};
const icon = (n, s = 20) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const spinner = '<span class="spinner" aria-hidden="true"></span>';

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
      `${study[i]}을(를) 공부하고 핵심 개념을 노트에 정리했습니다.`, i % 3 ? ['전공 역량'] : ['전공 역량', '성실성']));
  const member = (name, color, isPublic, doneNow, streak, entries) => ({
    id: uid(), name, color, public: isPublic, periodDays: 7, startDate: start,
    lastEntryDate: ago(doneNow ? 0 : 3), streak, entries: entries.map(([d, category, title, summary]) => ({ id: uid(), date: ago(d), category, title, summary, tags: [] })),
  });
  return {
    v: 1,
    profile: { name: '김에이머', bio: '정보시스템학과 3학년', photo: '', public: true, periodDays: 7, startDate: start, notify: false, font: 'pretendard', fontScale: 100 },
    categories: ['프로젝트', '대외활동', '동아리', '전공공부'],
    entries: [...rich, ...fillers].sort((a, b) => b.date.localeCompare(a.date)),
    groups: [
      {
        id: uid(), name: '정보시스템학과 24학번', code: 'IS24AM',
        members: [
          member('이지민', '#7c3aed', true, true, 15, [[0, '대외활동', '교내 홍보단 면접', '교내 홍보단 면접을 보고 자기소개를 준비했습니다.'], [9, '전공공부', '경영정보시스템 중간고사', 'ERP 개념을 정리하며 중간고사를 준비했습니다.']]),
          member('박서연', '#0891b2', true, false, 4, [[3, '프로젝트', '앱 프로젝트 UI 설계', '팀 앱 프로젝트에서 피그마로 화면 6개를 설계했습니다.']]),
          member('최도윤', '#ca8a04', true, true, 22, [[0, '대외활동', '빅데이터 교육 수료', '8주 빅데이터 교육을 수료하고 미니 프로젝트를 발표했습니다.'], [7, '동아리', '밴드 동아리 공연', '공연 기획에서 무대 순서 조율을 맡았습니다.']]),
          member('정하준', '#16a34a', false, false, 0, [[30, '전공공부', '회계원리 복습', '회계원리 분개를 복습했습니다.']]),
          member('한유나', '#db2777', true, false, 8, [[3, '대외활동', '봉사활동 기획', '지역아동센터 코딩 교실 커리큘럼을 짰습니다.']]),
        ],
      },
      {
        id: uid(), name: '데이터 공모전 팀', code: 'DATA4U',
        members: [
          member('이지민', '#7c3aed', true, true, 15, [[0, '대외활동', '교내 홍보단 면접', '교내 홍보단 면접을 보고 자기소개를 준비했습니다.']]),
          member('오세훈', '#ea580c', true, false, 2, [[4, '프로젝트', '시각화 대시보드', '공모전 결과를 대시보드로 만들었습니다.']]),
        ],
      },
    ],
    pokes: {},
    lastNotified: '',
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.v === 1) return s;
  } catch { /* 저장소를 못 쓰면 시연 데이터로 시작 */ }
  return seed();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { toast('저장 공간이 부족해 저장하지 못했어요.'); }
}

let S = load();
const ui = {
  sort: 'time', cat: 'all', demo: false, newGroup: false,
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
  let res;
  try {
    res = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task, input }) });
  } catch {
    throw new Error('서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
  }
  const body = await res.json().catch(() => ({ error: '서버 응답을 읽지 못했어요.' }));
  if (!res.ok || body.error) throw new Error(body.error || '요청에 실패했어요.');
  if (body.demo && !ui.demo) { ui.demo = true; renderTop(); }
  if (body.note) toast(body.note);
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
function memberStatus(m) {
  if (m.me) { const s = myStats(); return { done: s.doneNow, streak: s.streak }; }
  const cur = periodIndex(todayStr(), m.startDate, m.periodDays);
  return { done: periodIndex(m.lastEntryDate, m.startDate, m.periodDays) === cur, streak: m.streak };
}
const me = () => ({ id: 'me', me: true, name: S.profile.name, color: '#e11d48', photo: S.profile.photo, public: S.profile.public });
const avatar = (m) => `<span class="avatar" style="background:${esc(m.color)}">${m.photo ? `<img src="${m.photo}" alt="">` : esc((m.name || '?').slice(0, 1))}</span>`;
const durationText = (periods, len) => {
  const days = periods * len;
  return len % 30 === 0 ? `${periods * (len / 30)}개월` : `${Math.round(days / 7)}주`;
};

function entryCard(e, owner = true) {
  return `<article class="card entry">
    <div class="entry-meta"><span class="tag-cat">#${esc(e.category)}</span><time datetime="${e.date}">${fmt(e.date)}</time></div>
    <h3>${esc(e.title)}</h3>
    <p>${esc(e.summary)}</p>
    ${e.tags?.length ? `<ul class="tags" aria-label="역량">${e.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${e.raw ? `<details><summary>원본 보기</summary><div class="raw">
      <p class="pre">${esc(e.raw)}</p>
      ${(e.qa || []).map((x) => `<p class="qa-q">Q. ${esc(x.q)}</p><p class="pre">${x.a ? esc(x.a) : '<span class="muted">(답변 없음)</span>'}</p>`).join('')}
    </div></details>` : ''}
    ${owner ? `<button class="link danger" data-act="del-entry" data-v="${e.id}">기록 삭제</button>` : ''}
  </article>`;
}

// ───────── 1번 탭: 내 대시보드 ─────────
function dashboard() {
  const s = myStats();
  const p = S.profile;
  const status = s.current < 0
    ? `<section class="card"><p>${fmt(p.startDate)}부터 첫 기록 기간이 시작돼요.</p><button class="btn secondary block" data-act="record">${icon('plus')} 미리 기록하기</button></section>`
    : `<section class="card status ${s.doneNow ? 'done' : ''}" aria-label="이번 기록 기간">
      <div class="status-top"><span class="eyebrow">이번 기록 기간</span><span class="dday">${s.doneNow ? '완료' : `D-${s.left}`}</span></div>
      <p class="range">${fmt(s.ps)} ~ ${fmt(s.pe)}</p>
      ${s.doneNow
        ? `<p class="ok">${icon('check', 18)} 이번 기간 기록을 마쳤어요. 남길 경험이 더 있다면 추가해도 좋아요.</p>`
        : s.left <= 2
          ? `<p class="warn">${icon('bell', 18)} 기록 마감까지 ${s.left === 0 ? '오늘 하루' : `${s.left}일`} 남았어요.</p>`
          : '<p class="muted">이번 기간에 한 일을 남겨 주세요. 적을 게 없다면 그 주에 한 전공 공부도 좋아요.</p>'}
      <button class="btn ${s.doneNow ? 'secondary' : 'primary'} block" data-act="record">${icon('plus')} ${s.doneNow ? '기록 추가하기' : '이번 기간 경험 기록하기'}</button>
    </section>`;

  const first = S.entries.map((e) => e.date).sort()[0];
  const spanDays = first ? toDay(todayStr()) - toDay(first) : 0;
  const span = spanDays >= 60 ? `${Math.floor(spanDays / 30)}개월` : `${Math.max(1, Math.ceil(spanDays / 7))}주`;

  const cats = [...new Set([...S.categories, ...S.entries.map((e) => e.category)])];
  const shown = S.entries.filter((e) => ui.cat === 'all' || e.category === ui.cat).sort((a, b) => b.date.localeCompare(a.date));
  let list;
  if (!S.entries.length) list = `<div class="empty"><p>아직 기록이 없어요.<br>첫 한 걸음을 남겨 보세요.</p></div>`;
  else if (!shown.length) list = '<p class="empty">이 카테고리의 기록이 없어요.</p>';
  else if (ui.sort === 'cat') list = cats.filter((c) => shown.some((e) => e.category === c))
    .map((c) => `<h3 class="group-label">#${esc(c)} · ${shown.filter((e) => e.category === c).length}개</h3>${shown.filter((e) => e.category === c).map((e) => entryCard(e)).join('')}`).join('');
  else list = shown.map((e) => entryCard(e)).join('');

  return {
    html: `${status}
    <section class="stats" aria-label="기록 통계">
      <div><strong>${S.entries.length}회</strong><span>총 기록</span></div>
      <div><strong>${span}</strong><span>기록한 기간</span></div>
      <div><strong>${s.streak}회</strong><span>연속 기록</span></div>
    </section>
    <section style="display:grid;gap:12px" aria-labelledby="my-records">
      <div class="list-head"><h2 id="my-records">내 기록</h2>
        <div class="seg" role="group" aria-label="정렬 방식">
          <button data-act="sort" data-v="time" aria-pressed="${ui.sort === 'time'}">시간순</button>
          <button data-act="sort" data-v="cat" aria-pressed="${ui.sort === 'cat'}">카테고리순</button>
        </div>
      </div>
      <div class="chips" role="group" aria-label="카테고리 필터">
        ${['all', ...cats].map((c) => `<button class="chip" data-act="cat" data-v="${esc(c)}" aria-pressed="${ui.cat === c}">${c === 'all' ? '전체' : `#${esc(c)}`}</button>`).join('')}
      </div>
      ${list}
    </section>`,
  };
}

// ───────── 기록 작성 시트 ─────────
function openRecord() {
  ui.rec = { step: 'write', category: S.categories[0] || '기타', date: todayStr(), raw: '', questions: [], answers: [], draft: null, loading: false, error: '' };
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
  if (r.step === 'write') {
    body = `<p class="step">1 / 3 · 경험 쓰기</p>
      <fieldset><legend>카테고리</legend>
        <div class="chips wrap">${S.categories.map((c) => `<button type="button" class="chip" data-act="rec-cat" data-v="${esc(c)}" aria-pressed="${r.category === c}">#${esc(c)}</button>`).join('')}</div>
        <form class="inline" data-form="add-cat"><label class="sr-only" for="new-cat">새 카테고리 이름</label><input id="new-cat" name="label" maxlength="15" placeholder="새 카테고리 (예: 인턴)" autocomplete="off"><button class="btn small secondary">추가</button></form>
      </fieldset>
      <div class="field"><label for="rec-date">날짜</label><input type="date" id="rec-date" data-model="rec.date" value="${r.date}" max="${todayStr()}"></div>
      <div class="field"><label for="rec-raw">이번 기간에 한 일</label>
        <textarea id="rec-raw" rows="6" maxlength="4000" data-model="rec.raw" placeholder="예: 팀 프로젝트에서 회원가입 화면을 만들었어요.">${esc(r.raw)}</textarea>
        <p class="help">짧게 써도 괜찮아요. 부족한 부분은 AI가 질문으로 채워 드려요.</p></div>${err}`;
    foot = `<button class="btn primary" data-act="rec-next" ${r.loading ? 'disabled' : ''}>${busy('AI가 읽는 중…') || '다음'}</button>`;
  } else if (r.step === 'ask') {
    body = `<p class="step">2 / 3 · AI 꼬리질문</p>
      <p class="help">조금만 더 알려 주시면 나중에 자소서와 면접에 바로 쓸 수 있어요. 기억나지 않는 질문은 비워 두셔도 돼요.</p>
      ${r.questions.map((q, i) => `<div class="field"><label class="ai-q" for="qa-${i}">${esc(q)}</label><textarea id="qa-${i}" rows="3" maxlength="1000" data-model="rec.answers.${i}">${esc(r.answers[i] || '')}</textarea></div>`).join('')}${err}`;
    foot = `<button class="btn secondary" data-act="rec-back" ${r.loading ? 'disabled' : ''}>이전</button>
      <button class="btn primary" data-act="rec-summarize" ${r.loading ? 'disabled' : ''}>${busy('정리하는 중…') || 'AI로 정리하기'}</button>`;
  } else {
    const d = r.draft;
    body = `<p class="step">3 / 3 · 정리 확인</p>
      <p class="help">AI가 정리한 내용이에요. 틀린 곳은 직접 고칠 수 있고, 원문은 그대로 함께 저장돼요.</p>
      <div class="field"><label for="d-title">제목</label><input id="d-title" maxlength="60" data-model="rec.draft.title" value="${esc(d.title)}"></div>
      <div class="field"><label for="d-summary">요약</label><textarea id="d-summary" rows="5" maxlength="600" data-model="rec.draft.summary">${esc(d.summary)}</textarea></div>
      ${d.tags.length ? `<div class="field"><span class="eyebrow">드러난 역량</span><ul class="tags">${d.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}${err}`;
    foot = `<button class="btn secondary" data-act="rec-back">이전</button><button class="btn primary" data-act="rec-save">${icon('check')} 저장하기</button>`;
  }
  $('#sheet').innerHTML = `${head('경험 기록하기')}<div class="sheet-body">${body}</div><footer class="sheet-foot">${foot}</footer>`;
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

// ───────── 2번 탭: 부가 서비스 ─────────
const needEntries = () => (S.entries.length ? '' : `<div class="card empty"><p>먼저 경험을 기록해 주세요.</p><a class="btn primary" href="#/dashboard">기록하러 가기</a></div>`);

function services() {
  const item = (href, ic, title, desc) => `<a class="card nav-card" href="${href}"><span class="nav-ic">${icon(ic, 24)}</span><span><strong>${title}</strong><small>${desc}</small></span>${icon('next')}</a>`;
  return {
    html: `<p class="lead">지금까지 쌓은 ${S.entries.length}개의 기록으로 자소서와 면접을 준비해요.</p>
    ${item('#/services/interview', 'chat', '면접 예상 질문', '내 경험으로 만든 질문에 답하고 피드백 받기')}
    ${item('#/services/match', 'search', '자소서 문항 관련 경험 검색', '문항을 넣으면 가장 맞는 경험 찾기')}
    ${item('#/services/insight', 'trend', '성장 인사이트', '학기별 활동과 달라진 점 한눈에 보기')}`,
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
      <button class="btn primary block" data-act="iv-make" ${!iv.theme || iv.loading ? 'disabled' : ''}>${iv.loading === 'q' ? `${spinner} 질문 만드는 중…` : `${icon('sparkle')} 질문 만들기`}</button>
    </section>
    ${iv.questions.length ? `<section style="display:grid;gap:8px"><h2>예상 질문</h2><ul class="q-list">${iv.questions.map((x, i) => {
      const e = S.entries.find((en) => en.id === x.entry_id);
      return `<li><button class="q-btn" data-act="iv-pick" data-v="${i}" aria-pressed="${iv.active === i}"><span>${esc(x.question)}</span>${e ? `<small>근거: ${esc(e.title)} · ${fmt(e.date)}</small>` : ''}</button></li>`;
    }).join('')}</ul></section>` : ''}
    ${q ? `<section class="card">
      <h2>답변 연습</h2><p class="ai-q">${esc(q.question)}</p>
      ${src ? `<details><summary>내 기록 다시 보기</summary><div class="raw"><p><strong>${esc(src.title)}</strong></p><p>${esc(src.summary)}</p></div></details>` : ''}
      <div class="field"><label for="iv-answer">내 답변</label><textarea id="iv-answer" rows="6" maxlength="3000" data-model="interview.answer" placeholder="실제 면접처럼 말하듯이 써 보세요.">${esc(iv.answer)}</textarea></div>
      <button class="btn primary block" data-act="iv-eval" ${iv.loading ? 'disabled' : ''}>${iv.loading === 'e' ? `${spinner} 평가하는 중…` : '답변 평가 받기'}</button>
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
      <button class="btn primary block" data-act="m-run" ${m.loading ? 'disabled' : ''}>${m.loading ? `${spinner} 찾는 중…` : `${icon('search')} 어울리는 경험 찾기`}</button>
    </section>
    ${m.results ? (m.results.length ? `<h2>추천 경험 ${m.results.length}개</h2>${m.results.map((r, i) => {
      const e = S.entries.find((en) => en.id === r.id);
      return e ? `<article class="card"><span class="eyebrow">추천 ${i + 1} · #${esc(e.category)} · ${fmt(e.date)}</span><h3>${esc(e.title)}</h3><p>${esc(e.summary)}</p>
        <p class="ai-summary"><strong>추천 이유</strong><br>${esc(r.reason)}</p>${r.angle ? `<p class="tip">${esc(r.angle)}</p>` : ''}</article>` : '';
    }).join('')}` : '<p class="empty">어울리는 경험을 찾지 못했어요. 문항을 조금 바꿔 보세요.</p>') : ''}`,
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

function insight() {
  const sems = semesters();
  const max = Math.max(1, ...sems.map((s) => s.entries.length));
  const d = ui.insight.data;
  const count = (arr) => Object.entries(arr.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  return {
    title: '성장 인사이트', back: '#/services',
    html: needEntries() || `<section class="card"><h2>나의 대학생활 연대기</h2>
      <p class="help">${sems.length}개 학기 동안 ${S.entries.length}개의 경험을 기록했어요.</p>
      <button class="btn primary block" data-act="ins-run" ${ui.insight.loading ? 'disabled' : ''}>${ui.insight.loading ? `${spinner} 분석하는 중…` : `${icon('sparkle')} AI 성장 보고서 받기`}</button></section>
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
      : `<button class="btn secondary block" data-act="new-group">${icon('plus')} 새 그룹 만들기</button>`}`,
  };
}

function groupDetail(g) {
  const ms = groupMembers(g);
  const done = ms.filter((m) => memberStatus(m).done).length;
  return {
    title: g.name, back: '#/groups',
    html: `<section class="card">
      <div class="group-head"><span class="eyebrow">이번 기록 기간</span><button class="chip" data-act="copy" data-v="${esc(g.code)}">${icon('copy', 16)} 초대 코드 ${esc(g.code)}</button></div>
      <p><strong>${ms.length}명 중 ${done}명</strong>이 이번 기간 기록을 마쳤어요.</p>
      <div class="bar" role="img" aria-label="${ms.length}명 중 ${done}명 완료"><span style="width:${(done / ms.length) * 100}%"></span></div>
      <p class="help">시연 버전에서는 초대 코드가 실제로 전송되지 않아요.</p>
    </section>
    <section class="card"><h2>멤버</h2><ul class="members">${ms.map((m) => {
      const st = memberStatus(m);
      const poked = !m.me && S.pokes[pokeKey(g, m)];
      return `<li class="member">
        <a class="member-link" href="${m.me ? '#/profile' : `#/groups/${g.id}/m/${m.id}`}">
          <span class="ring fire-${fireLevel(st.streak)}">${avatar(m)}</span>
          <span class="m-info"><strong>${esc(m.name)}${m.me ? ' (나)' : ''}${m.public ? '' : ` ${icon('lock', 14)}`}</strong>
          <small class="${st.done ? '' : 'late'}">${st.done ? '기록 완료' : '미작성'} · 연속 ${st.streak}회</small></span>
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
      <span class="ring fire-${fireLevel(st.streak)}">${avatar(m)}</span>
      <h2>${esc(m.name)}</h2><p class="muted">연속 ${st.streak}회 기록 · ${esc(g.name)}</p>
      ${fireLevel(st.streak) ? `<span class="flame-note">${icon('flame', 18)} 프로필이 불타는 중</span>` : ''}
    </section>
    ${m.public
      ? (m.entries.length ? m.entries.map((e) => entryCard(e, false)).join('') : '<p class="empty">아직 공개된 기록이 없어요.</p>')
      : `<section class="card lock">${icon('lock', 28)}<p><strong>비공개 계정이에요</strong><br>${esc(m.name)}님이 기록을 비공개로 설정했어요.</p></section>`}`,
  };
}

// ───────── 4번 탭: 개인 프로필 ─────────
function profile() {
  const p = S.profile;
  const s = myStats();
  const lvl = fireLevel(s.streak);
  return {
    html: `<section class="profile-top">
      <span class="ring fire-${lvl}">${avatar(me())}</span>
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
      <div class="field"><label for="pf-period">작성 기간</label><select id="pf-period" data-pf="periodDays">
        ${[[7, '매주'], [14, '2주마다'], [30, '한 달마다']].map(([v, l]) => `<option value="${v}" ${p.periodDays === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="pf-start">시작 날짜</label><input type="date" id="pf-start" data-pf="startDate" value="${p.startDate}" required></div>
      <label class="switch-row" for="pf-notify"><span>마감 알림<small>기간이 끝나기 2일 전부터 앱을 열면 알려 드려요</small></span><input type="checkbox" role="switch" id="pf-notify" data-pf="notify" ${p.notify ? 'checked' : ''}></label>
    </section>
    <section class="card"><h2>화면 설정</h2>
      <div class="field"><label for="pf-font">글꼴</label><select id="pf-font" data-pf="font">
        ${[['pretendard', '기본 (프리텐다드)'], ['noto', '본고딕'], ['gowun', '고운바탕']].map(([v, l]) => `<option value="${v}" ${p.font === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="pf-scale">글자 크기 <output id="scale-out">${p.fontScale}%</output></label><input type="range" id="pf-scale" min="90" max="130" step="10" data-pf="fontScale" value="${p.fontScale}"></div>
    </section>
    <button class="btn secondary block" data-act="reset">시연 데이터로 초기화</button>`,
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
  document.documentElement.style.setProperty('--font', FONTS[S.profile.font] || FONTS.pretendard);
  document.documentElement.style.fontSize = `${S.profile.fontScale}%`;
}

function maybeNotify() {
  const s = myStats();
  const today = todayStr();
  if (!S.profile.notify || s.doneNow || s.current < 0 || s.left > 2 || S.lastNotified === today) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  // shortcut: 앱을 열었을 때만 알림. 앱을 닫아도 오는 알림은 서비스 워커 + 푸시 서버가 필요.
  new Notification('AIMers', { body: `기록 마감까지 ${s.left === 0 ? '오늘 하루' : `${s.left}일`} 남았어요. 이번 기간 경험을 남겨 주세요.`, icon: 'icon.svg' });
  S.lastNotified = today;
  save();
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
  return dashboard();
}

let current;
function renderTop() {
  const v = current || {};
  const badge = ui.demo ? '<span class="badge" title="AI 키 없이 미리 준비한 답변을 보여 줘요">시연 모드</span>' : '';
  $('#topbar').innerHTML = v.back
    ? `<a class="icon-btn" href="${v.back}" aria-label="뒤로">${icon('back', 24)}</a><h1>${esc(v.title)}</h1>${badge}`
    : `<h1 class="logo">AIM<b>ers</b></h1>${badge}`;
}
function render(scroll = false) {
  current = view();
  renderTop();
  $('#main').innerHTML = current.html;
  const tab = route()[0] || 'dashboard';
  document.querySelectorAll('.tabbar a').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.title = current.title ? `${current.title} · AIMers` : 'AIMers';
  if (scroll) { window.scrollTo(0, 0); $('#main').focus({ preventScroll: true }); }
}

// ───────── 이벤트 ─────────
const actions = {
  record: openRecord,
  sort: (el) => { ui.sort = el.dataset.v; render(); },
  cat: (el) => { ui.cat = el.dataset.v; render(); },
  'del-entry': (el) => {
    if (!confirm('이 기록을 삭제할까요? 되돌릴 수 없어요.')) return;
    S.entries = S.entries.filter((e) => e.id !== el.dataset.v);
    save(); render(); toast('기록을 삭제했어요.');
  },
  'close-sheet': () => {
    if (ui.rec?.raw.trim() && !confirm('작성 중인 내용이 사라져요. 닫을까요?')) return;
    $('#sheet').close();
  },
  'rec-cat': (el) => { ui.rec.category = el.dataset.v; renderSheet(); },
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
  'rec-save': () => {
    const r = ui.rec;
    if (!r.draft.title.trim() || !r.draft.summary.trim()) { r.error = '제목과 요약을 입력해 주세요.'; renderSheet(); return; }
    const before = myStats().streak;
    S.entries.unshift({
      id: uid(), date: r.date, category: r.category, title: r.draft.title.trim(), summary: r.draft.summary.trim(),
      raw: r.raw.trim(), qa: r.questions.map((q, i) => ({ q, a: (r.answers[i] || '').trim() })), tags: r.draft.tags,
    });
    save();
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
    try { m.results = (await ai('match', { prompt: m.prompt, entries: S.entries.slice(0, 80).map(brief) })).matches; } catch (e) { toast(e.message); }
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
  poke: (el) => {
    const g = S.groups.find((x) => x.id === el.dataset.g);
    const m = g?.members.find((x) => x.id === el.dataset.v);
    if (!m) return;
    S.pokes[pokeKey(g, m)] = todayStr();
    save(); render();
    toast(`${m.name}님을 콕 찔렀어요. 기록을 독촉하는 알림이 갔어요.`);
  },
  reset: () => {
    if (!confirm('모든 기록과 설정을 지우고 시연 데이터로 되돌릴까요?')) return;
    S = seed(); save(); applyPrefs(); ui.insight.data = null; ui.match.results = null;
    ui.interview = { theme: '', questions: [], active: -1, answer: '', feedback: null, loading: '' };
    location.hash = '#/dashboard'; render(true); toast('시연 데이터로 초기화했어요.');
  },
};

const forms = {
  'add-cat': (f) => {
    const name = f.elements.label.value.trim().replace(/^#/, '');
    if (!name) return;
    if (!S.categories.includes(name)) { S.categories.push(name); save(); }
    ui.rec.category = name;
    renderSheet();
  },
  'new-group': (f) => {
    const name = f.elements.label.value.trim();
    if (!name) return;
    const g = { id: uid(), name, code: Math.random().toString(36).slice(2, 8).toUpperCase(), members: [] };
    S.groups.push(g); ui.newGroup = false; save();
    location.hash = `#/groups/${g.id}`;
    toast('그룹을 만들었어요. 초대 코드를 친구에게 보내 보세요.');
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
    if (key === 'notify' && el.checked) {
      if (!('Notification' in window)) { toast('이 브라우저는 알림을 지원하지 않아요.'); p.notify = false; }
      else if ((await Notification.requestPermission()) !== 'granted') { toast('브라우저 알림이 꺼져 있어요. 설정에서 허용해 주세요.'); p.notify = false; }
      else toast('마감 2일 전부터 알려 드릴게요.');
    }
  } else if (key === 'periodDays' || key === 'fontScale') {
    p[key] = Number(el.value);
  } else if (key === 'startDate') {
    if (!el.value) { toast('시작 날짜를 골라 주세요.'); return; }
    p.startDate = el.value;
  } else {
    p[key] = el.value.trim() || (key === 'name' ? '나' : '');
  }
  save(); applyPrefs();
  if (key !== 'name' && key !== 'bio') render();
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
});
document.addEventListener('submit', (ev) => {
  const f = ev.target.dataset?.form;
  if (!f) return;
  ev.preventDefault();
  forms[f]?.(ev.target);
});
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.model) setModel(t.dataset.model, t.value);
  if (t.dataset.pf === 'fontScale') { $('#scale-out').textContent = `${t.value}%`; S.profile.fontScale = Number(t.value); applyPrefs(); }
});
document.addEventListener('change', (ev) => { if (ev.target.dataset.pf) setPref(ev.target); });
$('#sheet').addEventListener('cancel', (ev) => {
  if (ui.rec?.raw.trim() && !confirm('작성 중인 내용이 사라져요. 닫을까요?')) ev.preventDefault();
});
window.addEventListener('hashchange', () => render(true));

applyPrefs();
render();
maybeNotify();
fetch('/api/status').then((r) => r.json()).then((s) => { if (s.demo) { ui.demo = true; renderTop(); } }).catch(() => {});
