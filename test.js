import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { periodIndex, streakInfo, daysLeft, semesterOf, fireLevel } from './public/logic.js';

process.env.AIMERS_DEMO = '1';
const { runTask } = await import('./ai.js');
const { handle } = await import('./server.js');

test('기록 기간과 연속 기록 계산', () => {
  const start = '2026-01-05';
  assert.equal(periodIndex('2026-01-11', start, 7), 0);
  assert.equal(periodIndex('2026-01-12', start, 7), 1);
  assert.equal(daysLeft('2026-01-10', start, 7), 1);
  // 0,1,2 기간 기록, 3(현재) 미기록 → 진행 중이므로 연속 3
  const dates = ['2026-01-06', '2026-01-13', '2026-01-20'];
  assert.deepEqual(streakInfo(dates, start, 7, '2026-01-27'), { current: 3, doneNow: false, streak: 3, best: 3, completed: 3 });
  // 한 기간 건너뛰면 끊김
  assert.equal(streakInfo(['2026-01-06', '2026-01-20'], start, 7, '2026-01-27').streak, 1);
  assert.equal(streakInfo(dates, '2026-03-01', 7, '2026-01-27').streak, 0);
});

test('학기 구분과 불타는 단계', () => {
  assert.equal(semesterOf('2026-03-02').label, '2026년 1학기');
  assert.equal(semesterOf('2026-08-31').label, '2026년 1학기');
  assert.equal(semesterOf('2026-11-07').label, '2026년 2학기');
  assert.equal(semesterOf('2027-02-10').label, '2026년 2학기');
  assert.deepEqual([9, 10, 19, 20].map(fireLevel), [0, 1, 1, 2]);
});

test('AI 입력 검증', async () => {
  assert.equal((await runTask('nope', {})).error, '알 수 없는 기능입니다.');
  assert.ok((await runTask('followup', { raw: '   ' })).error);
  assert.ok((await runTask('evaluate', { question: 'Q' })).error);
  assert.ok((await runTask('match', { prompt: '협업 경험', entries: [] })).error);
});

test('시연 모드 꼬리질문과 정리', async () => {
  const short = await runTask('followup', { raw: '팀 프로젝트 함', category: '프로젝트' });
  assert.equal(short.demo, true);
  assert.equal(short.data.enough, false);
  assert.ok(short.data.questions.length >= 1 && short.data.questions.length <= 3);
  const full = await runTask('followup', { raw: '팀에서 백엔드를 맡았고 배포 오류 문제를 해결해 결과적으로 기한 안에 완성했다.' });
  assert.deepEqual(full.data, { enough: true, questions: [] });
  const sum = await runTask('summarize', { raw: '조별과제 발표를 맡았다', category: '프로젝트', qa: [{ q: '결과는?', a: 'A+을 받았다' }] });
  assert.ok(sum.data.title && sum.data.summary);
  assert.ok(sum.data.tags.every((t) => ['협업', '커뮤니케이션', '전공 역량', '성실성'].includes(t)));
});

test('자소서 매칭은 있는 기록 id만 돌려준다', async () => {
  const entries = [
    { id: 'a', title: '팀 프로젝트', summary: '팀원과 협업해 문제를 해결', tags: ['협업'] },
    { id: 'b', title: 'SQL 공부', summary: '매일 문제 풀이', tags: ['성실성'] },
  ];
  const r = await runTask('match', { prompt: '협업 경험을 쓰시오', entries });
  assert.equal(r.data.matches[0].id, 'a');
  assert.ok(r.data.matches.every((m) => ['a', 'b'].includes(m.id)));
});

test('서버: 정적 파일, 경로 탈출 차단, API', async () => {
  const srv = http.createServer(handle).listen(0);
  const base = `http://localhost:${srv.address().port}`;
  try {
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(`${base}/..%2fai.js`)).status, 403);
    const ok = await fetch(`${base}/api/ai`, { method: 'POST', body: JSON.stringify({ task: 'followup', input: { raw: '동아리 활동' } }) });
    assert.equal(ok.status, 200);
    const bad = await fetch(`${base}/api/ai`, { method: 'POST', body: '{oops' });
    assert.equal(bad.status, 400);
  } finally {
    srv.close();
  }
});
