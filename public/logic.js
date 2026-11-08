// 날짜·기록 기간 계산 (브라우저와 테스트에서 함께 사용)
const DAY = 86400000;

export const toDay = (s) => Math.floor(Date.parse(`${s}T00:00:00Z`) / DAY);
export const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const weekday = (s) => new Date(toDay(s) * DAY).getUTCDay(); // 0 = 일요일

export function todayStr(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export const periodIndex = (date, start, len) => Math.floor((toDay(date) - toDay(start)) / len);

export function periodRange(i, start, len) {
  const s = toDay(start) + i * len;
  return [fromDay(s), fromDay(s + len - 1)];
}

export const daysLeft = (today, start, len) => toDay(periodRange(periodIndex(today, start, len), start, len)[1]) - toDay(today);

// streak: 지금까지 빠짐없이 기록한 기간 수. 진행 중인 기간은 아직 안 썼어도 끊긴 것으로 보지 않는다.
export function streakInfo(dates, start, len, today) {
  const current = periodIndex(today, start, len);
  if (current < 0) return { current, doneNow: false, streak: 0, best: 0, completed: 0 };
  const done = new Set(dates.map((d) => periodIndex(d, start, len)).filter((i) => i >= 0 && i <= current));
  const doneNow = done.has(current);
  let streak = 0;
  for (let i = doneNow ? current : current - 1; i >= 0 && done.has(i); i--) streak++;
  let best = 0;
  let run = 0;
  for (let i = 0; i <= current; i++) {
    run = done.has(i) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current, doneNow, streak, best, completed: done.size };
}

// 1학기: 3~8월(여름방학 포함), 2학기: 9~2월(겨울방학 포함)
export function semesterOf(date) {
  const [y, m] = date.split('-').map(Number);
  if (m >= 3 && m <= 8) return { key: `${y}-1`, label: `${y}년 1학기` };
  if (m >= 9) return { key: `${y}-2`, label: `${y}년 2학기` };
  return { key: `${y - 1}-2`, label: `${y - 1}년 2학기` };
}

// 검색어가 날짜 모양이면 날짜 조건으로 바꾼다: 2026.11.08 / 2026-11-08 / 11.08 / 11월 8일 / 11월 / 2026년 11월
export function parseDateQuery(q) {
  const s = q.trim().replace(/\s+/g, ' ');
  let m;
  if ((m = s.match(/^(\d{4}) ?[.\-/년] ?(\d{1,2}) ?[.\-/월] ?(\d{1,2}) ?일?\.?$/))) return { y: +m[1], m: +m[2], d: +m[3] };
  if ((m = s.match(/^(\d{4}) ?[.\-/년] ?(\d{1,2}) ?월?\.?$/))) return { y: +m[1], m: +m[2] };
  if ((m = s.match(/^(\d{1,2}) ?[./] ?(\d{1,2})\.?$/)) || (m = s.match(/^(\d{1,2}) ?월 ?(\d{1,2}) ?일?$/))) return { m: +m[1], d: +m[2] };
  if ((m = s.match(/^(\d{1,2}) ?월$/))) return { m: +m[1] };
  return null;
}

// 기록 검색: 날짜 모양이면 날짜로, 아니면 제목·요약·원문·답변·카테고리·태그에서 모든 단어를 찾는다
export function matchEntry(e, q) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const dq = parseDateQuery(s);
  if (dq) {
    const [y, m, d] = e.date.split('-').map(Number);
    return (!dq.y || dq.y === y) && (!dq.m || dq.m === m) && (!dq.d || dq.d === d);
  }
  const hay = [e.title, e.summary, e.raw, e.category, ...(e.tags || []), ...(e.qa || []).flatMap((x) => [x.q, x.a])].join(' ').toLowerCase();
  return s.split(/\s+/).every((w) => hay.includes(w));
}

export const fireLevel =(streak) => (streak >= 20 ? 2 : streak >= 10 ? 1 : 0);
