/**
 * 배대지 주문서 페이지에 주입하는 주문 선택 패널 (Phase 4, vanilla DOM).
 *
 * scan-notification과 같은 격리 전략: 고유 ID + 최상단 z-index + inline style.
 * 캡처된 pending order 목록을 보여주고, 사용자가 "채우기"를 누른 주문 한 건을 콜백으로 넘긴다.
 * **채우기는 폼에 값만 넣고 제출은 하지 않는다** — 패널은 그 선택 UI일 뿐이다(명세서 §8).
 */
import type { PendingOrder } from './schemas';

const PANEL_ID = 'zoas-baedaeji-panel';

const PANEL_STYLE = [
  'position: fixed',
  'top: 16px',
  'right: 16px',
  'width: 300px',
  'max-height: 70vh',
  'overflow-y: auto',
  'z-index: 2147483647',
  'background: rgba(20, 20, 30, 0.96)',
  'color: white',
  'padding: 12px',
  'border-radius: 10px',
  'font: 13px/1.4 system-ui, -apple-system, sans-serif',
  'box-shadow: 0 6px 20px rgba(0,0,0,0.35)',
].join(';');

const ROW_STYLE = [
  'display: flex',
  'justify-content: space-between',
  'align-items: center',
  'gap: 8px',
  'padding: 8px 0',
  'border-top: 1px solid rgba(255,255,255,0.12)',
].join(';');

const FILL_BTN_STYLE = [
  'flex: none',
  'background: #4f7cff',
  'color: white',
  'border: 0',
  'border-radius: 6px',
  'padding: 5px 10px',
  'font: 12px system-ui, sans-serif',
  'cursor: pointer',
].join(';');

/**
 * 주문 목록 패널을 (재)렌더한다. onFill은 사용자가 특정 주문의 "채우기"를 눌렀을 때 호출.
 * 이미 떠 있으면 갈아끼운다.
 */
export function renderBaedaejiPanel(
  orders: PendingOrder[],
  onFill: (order: PendingOrder) => void,
): void {
  removeBaedaejiPanel();

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('style', PANEL_STYLE);

  const header = document.createElement('div');
  header.setAttribute('style', 'display:flex;justify-content:space-between;align-items:center;font-weight:600;margin-bottom:4px');
  const title = document.createElement('span');
  title.textContent = 'ZOAS · 배대지 자동 채움';
  const close = document.createElement('button');
  close.textContent = '✕';
  close.setAttribute('aria-label', '닫기');
  close.setAttribute('style', 'background:none;border:0;color:white;cursor:pointer;font-size:14px');
  close.addEventListener('click', removeBaedaejiPanel);
  header.appendChild(title);
  header.appendChild(close);
  panel.appendChild(header);

  if (orders.length === 0) {
    const empty = document.createElement('div');
    empty.setAttribute('style', 'padding:8px 0;opacity:0.7');
    empty.textContent = '채울 주문이 없습니다';
    panel.appendChild(empty);
  } else {
    for (const order of orders) {
      panel.appendChild(buildRow(order, onFill));
    }
  }

  const hint = document.createElement('div');
  hint.setAttribute('style', 'margin-top:8px;font-size:11px;opacity:0.65');
  hint.textContent = '값만 채웁니다 · 검토 후 직접 제출하세요';
  panel.appendChild(hint);

  document.documentElement.appendChild(panel);
}

function buildRow(
  order: PendingOrder,
  onFill: (order: PendingOrder) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.setAttribute('style', ROW_STYLE);

  const info = document.createElement('div');
  info.setAttribute('style', 'min-width:0');
  const name = document.createElement('div');
  name.setAttribute('style', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
  name.textContent = order.productName || '(상품명 없음)';
  const meta = document.createElement('div');
  meta.setAttribute('style', 'font-size:11px;opacity:0.7');
  meta.textContent = [
    order.price ? `${order.price.amount} ${order.price.currency}` : null,
    order.orderNumber ? `#${order.orderNumber}` : '주문번호 미확정',
  ]
    .filter(Boolean)
    .join(' · ');
  info.appendChild(name);
  info.appendChild(meta);

  const btn = document.createElement('button');
  btn.textContent = '채우기';
  btn.setAttribute('style', FILL_BTN_STYLE);
  btn.addEventListener('click', () => onFill(order));

  row.appendChild(info);
  row.appendChild(btn);
  return row;
}

export function removeBaedaejiPanel(): void {
  document.getElementById(PANEL_ID)?.remove();
}
