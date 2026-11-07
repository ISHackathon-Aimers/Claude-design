// 날짜·기록 기간 계산 (브라우저와 테스트에서 함께 사용)
const DAY = 86400000;

export const toDay = (s) => Math.floor(Date.parse(`${s}T00:00:00Z`) / DAY);
export const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);

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

export const fireLevel = (streak) => (streak >= 20 ? 2 : streak >= 10 ? 1 : 0);
