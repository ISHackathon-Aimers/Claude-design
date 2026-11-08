import { PLANS } from './plans.js';

// This preview has no payment API, SDK, storage or membership dependency.
export function openPaymentPreview(key) {
  if (!Object.hasOwn(PLANS, key)) return;
  let dialog = document.querySelector('#payment-preview');
  if (dialog?.open) return;
  dialog?.remove();
  const opener = document.activeElement;
  const plan = PLANS[key];
  const duration = key === 'annual' ? '1년' : '1개월';
  dialog = document.createElement('dialog');
  dialog.id = 'payment-preview'; dialog.className = 'payment-preview';
  dialog.setAttribute('aria-labelledby', 'payment-preview-title');
  dialog.setAttribute('aria-describedby', 'payment-preview-notice');
  const button = (action, label, primary = false) => `<button class="btn ${primary ? 'primary' : 'secondary'} block" data-preview="${action}">${label}</button>`;
  function draw(stage = 'checkout') {
    let content;
    if (stage === 'success') {
      content = `<div role="status"><h3>결제 성공 시연</h3><p class="help">실제 결제가 확인되면 아래와 같이 이용권이 표시돼요.</p></div>
        <section class="card"><span class="eyebrow">이용권 적용 화면 예시</span><h3>AIMers+ ${duration} 이용권</h3><p class="help">결제 금액 ${plan.label}</p><p class="help">프리미엄 기능 이용 가능</p></section>
        <p class="help">현재 계정의 이용권과 프리미엄 기능은 변경되지 않았어요.</p>${button('checkout', '다른 결과 체험하기')}`;
    } else if (stage === 'failure') {
      content = `<div role="alert"><h3>결제 실패 시연</h3><p class="help">승인되지 않은 결제예요. 결제수단을 확인한 뒤 다시 시도해 주세요.</p></div>
        <p class="help">실패한 결제는 이용권에 반영되지 않는 흐름을 체험하고 있어요.</p>${button('checkout', '다시 시도하기', true)}`;
    } else if (stage === 'cancel') {
      content = `<div role="status"><h3>결제 취소 시연</h3><p class="help">결제창을 닫았어요. 선택한 이용권으로 다시 시작할 수 있어요.</p></div>${button('checkout', '결제 화면으로 돌아가기', true)}`;
    } else {
      content = `<section class="card"><span class="eyebrow">선택한 이용권</span><h3>AIMers+ ${duration} 이용권</h3><strong class="preview-price">${plan.label}</strong><p class="help">결과를 선택해 결제 후 화면을 체험해 보세요.</p></section>
        ${button('success', '결제 성공 체험하기', true)}${button('failure', '결제 실패 체험하기')}${button('cancel', '결제창 취소 체험하기')}`;
    }
    dialog.innerHTML = `<div class="preview-body"><span class="plan-badge">시연 모드</span><h2 id="payment-preview-title">결제 흐름 미리보기</h2>
      <p class="help" id="payment-preview-notice">실제 청구와 이용권 변경 없이 화면만 체험해요. 카드 정보를 입력하지 않아요.</p>
      ${content}${button('close', '미리보기 닫기')}</div>`;
    // Keep keyboard focus within the native dialog after replacing its contents.
    if (dialog.open) dialog.querySelector('button')?.focus();
  }
  dialog.addEventListener('click', (event) => {
    const action = event.target.closest('[data-preview]')?.dataset.preview;
    if (action === 'close') dialog.close();
    else if (['checkout', 'success', 'failure', 'cancel'].includes(action)) draw(action);
    else if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => { dialog.remove(); if (opener?.isConnected) opener.focus(); }, { once: true });
  draw(); document.body.append(dialog); dialog.showModal();
}
