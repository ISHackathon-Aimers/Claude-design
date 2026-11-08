import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSaveFeedback, loadingMarkup } from './public/feedback.js';

function fixture(t) {
  const dom = new JSDOM('<div id="status" role="status" aria-live="polite"></div>');
  const node = dom.window.document.querySelector('#status');
  const feedback = createSaveFeedback(node);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { feedback.destroy(); dom.window.close(); });
  return { node, feedback };
}

test('initial and background loads do not show a permanent saved message', (t) => {
  const { node, feedback } = fixture(t);
  feedback.update('idle'); t.mock.timers.tick(10000);
  feedback.update('idle');
  assert.equal(node.textContent, '');
});
test('save feedback avoids a spinner flash and removes success after a short confirmation', (t) => {
  const { node, feedback } = fixture(t);
  feedback.update('saving'); t.mock.timers.tick(100);
  assert.equal(node.textContent, '');
  feedback.update('idle');
  assert.match(node.textContent, /저장했어요/);
  feedback.update('idle');
  t.mock.timers.tick(1600);
  assert.equal(node.textContent, '');
});
test('ongoing saves show progress, then errors remain until retry and conflict actions stay available', (t) => {
  const { node, feedback } = fixture(t);
  feedback.update('saving'); t.mock.timers.tick(180);
  assert.equal(node.dataset.state, 'saving');
  feedback.update('error', '연결 실패 <script>bad()</script>'); t.mock.timers.tick(10000);
  assert.ok(node.querySelector('[data-act="retry-save"]'));
  assert.equal(node.querySelector('script'), null);
  feedback.update('saving'); t.mock.timers.tick(180);
  assert.equal(node.querySelector('[data-act="retry-save"]'), null);
  feedback.update('conflict', '다른 기기에서 수정했어요.');
  assert.ok(node.querySelector('[data-act="export-data"]'));
  assert.ok(node.querySelector('[data-act="reload-data"]'));
  assert.equal(node.querySelector('[data-act="retry-save"]'), null);
});
test('a new save cancels the previous success timer and loading skeletons are decorative', (t) => {
  const { node, feedback } = fixture(t);
  feedback.update('saving'); feedback.update('idle');
  t.mock.timers.tick(1500); feedback.update('saving');
  t.mock.timers.tick(180);
  assert.equal(node.dataset.state, 'saving');
  const dom = new JSDOM(loadingMarkup('기록을 불러오고 있어요', '<unsafe>'));
  assert.ok(dom.window.document.querySelector('[role="status"]'));
  assert.equal(dom.window.document.querySelector('.loading-preview').getAttribute('aria-hidden'), 'true');
  assert.equal(dom.window.document.querySelector('unsafe'), null);
  dom.window.close();
});
