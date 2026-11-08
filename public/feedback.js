const escape = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const check = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>';
const alert = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></svg>';

export function loadingMarkup(title, detail) {
  return `<section class="loading-view" aria-label="화면 준비 중"><div class="loading-brand" aria-hidden="true"><img src="/icon.svg" width="52" height="52" alt=""><span class="loading-orbit"></span></div>
    <div class="loading-copy" role="status"><h1>${escape(title)}</h1><p>${escape(detail)}</p></div>
    <div class="loading-preview" aria-hidden="true"><div class="skeleton skeleton-title"></div><div class="skeleton"></div><div class="skeleton skeleton-short"></div><div class="skeleton skeleton-block"></div></div></section>`;
}

// Idle is empty. Only a real write transitions to a short-lived success message.
export function createSaveFeedback(element, { delay = 180, duration = 1600 } = {}) {
  let previous = 'idle';
  let lastMessage = '';
  let showTimer;
  let hideTimer;
  const clearTimers = () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  const hide = () => { element.replaceChildren(); delete element.dataset.state; };
  return {
    update(state, message = '') {
      if (state === previous && (state !== 'error' && state !== 'conflict' || message === lastMessage)) return;
      const wasSaving = previous === 'saving';
      previous = state;
      lastMessage = message;
      clearTimers();
      if (state === 'saving') {
        hide();
        showTimer = setTimeout(() => {
          element.dataset.state = 'saving';
          element.innerHTML = '<div class="sync-pill"><span class="spinner" aria-hidden="true"></span><span>저장하고 있어요</span></div>';
        }, delay);
      } else if (state === 'error' || state === 'conflict') {
        element.dataset.state = state;
        element.innerHTML = `<div class="sync-alert"><span class="sync-alert-icon">${alert}</span><div class="sync-alert-copy"><strong>${state === 'conflict' ? '다른 기기의 변경을 확인해 주세요' : '저장을 완료하지 못했어요'}</strong><p>${escape(message)}</p>
          <div class="sync-actions"><button class="btn small secondary" data-act="export-data">변경 내용 내보내기</button>${state === 'conflict'
            ? '<button class="btn small secondary" data-act="reload-data">최신 기록 불러오기</button>'
            : '<button class="btn small primary" data-act="retry-save">다시 저장</button>'}</div></div></div>`;
      } else if (wasSaving) {
        element.dataset.state = 'saved';
        element.innerHTML = `<div class="sync-pill">${check}<span>저장했어요</span></div>`;
        hideTimer = setTimeout(hide, duration);
      } else hide();
    },
    destroy() { clearTimers(); hide(); },
  };
}
