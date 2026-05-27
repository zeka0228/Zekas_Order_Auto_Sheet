/**
 * 페이지 우상단 toast 알림 — ZOAS가 백그라운드에서 작동 중임을 사용자에게 보여줌.
 *
 * Why:
 *   - 자동 캡처(cart 진입·form submit)는 사용자 모르게 일어나 ZOAS가 작동 중인지 피드백 0.
 *   - 사용자가 "왜 안 잡혀?"·"잡힌 거 맞나?" 같은 의문 갖지 않도록 시각적 신호 제공.
 *
 * 구현 단순화:
 *   - vanilla DOM injection. 고유 ID(zoas-scan-toast)와 매우 높은 z-index로 페이지와 격리.
 *   - inline style — 페이지 CSS 영향 회피. Shadow DOM은 추후 보강 후보.
 *   - 같은 toast가 연속 호출되면 갈아끼움(removeCurrentToast).
 */

export type ScanStatus = 'recognized' | 'scanning' | 'completed' | 'error';

const STATUS_TEXT: Record<ScanStatus, { text: string; emoji: string }> = {
  recognized: { text: '해외 사이트 주문 인식', emoji: '🌐' },
  scanning: { text: '스캔 진행 중', emoji: '🔍' },
  completed: { text: '스캔 완료', emoji: '✓' },
  error: { text: '스캔 실패', emoji: '⚠' },
};

const TOAST_ID = 'zoas-scan-toast';

const TOAST_STYLE = [
  'position: fixed',
  'top: 16px',
  'right: 16px',
  // z-index 상한값(2^31 - 1, int32 max). 쇼핑몰 페이지가 자체 모달·헤더에
  // 큰 값을 박아도 그 위로 뜨도록 — 임의 큰 수가 아니라 명세상 최댓값.
  'z-index: 2147483647',
  'background: rgba(20, 20, 30, 0.92)',
  'color: white',
  'padding: 8px 14px',
  'border-radius: 8px',
  'font: 13px/1.4 system-ui, -apple-system, sans-serif',
  'box-shadow: 0 4px 12px rgba(0,0,0,0.3)',
  'display: flex',
  'gap: 8px',
  'align-items: center',
  'transition: opacity 200ms ease',
  'opacity: 0',
  'pointer-events: none',
].join(';');

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showScanNotification(
  status: ScanStatus,
  autoHideMs: number = 2500,
): void {
  removeCurrentToast();

  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.setAttribute('style', TOAST_STYLE);

  const { text, emoji } = STATUS_TEXT[status];
  const emojiSpan = document.createElement('span');
  emojiSpan.textContent = emoji;
  const textSpan = document.createElement('span');
  textSpan.textContent = `ZOAS · ${text}`;
  toast.appendChild(emojiSpan);
  toast.appendChild(textSpan);

  document.documentElement.appendChild(toast);
  // 페이드 인
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });

  if (autoHideMs > 0) {
    hideTimer = setTimeout(() => {
      hideScanNotification();
    }, autoHideMs);
  }
}

export function hideScanNotification(): void {
  const toast = document.getElementById(TOAST_ID);
  if (!toast) return;
  toast.style.opacity = '0';
  setTimeout(() => {
    toast.parentNode?.removeChild(toast);
  }, 250);
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function removeCurrentToast(): void {
  const existing = document.getElementById(TOAST_ID);
  if (existing?.parentNode) existing.parentNode.removeChild(existing);
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}
