import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderBaedaejiPanel, removeBaedaejiPanel } from './baedaeji-panel';
import { PendingOrderSchema, type PendingOrder } from './schemas';

function order(partial: Partial<PendingOrder>): PendingOrder {
  return PendingOrderSchema.parse({
    id: partial.id ?? 'id-1',
    domain: 'shop.example.com',
    url: 'https://shop.example.com/checkout',
    capturedAt: 1_700_000_000_000,
    source: 'checkout',
    ...partial,
  });
}

afterEach(() => {
  removeBaedaejiPanel();
});

describe('renderBaedaejiPanel', () => {
  it('주문 목록을 행으로 렌더하고 힌트를 표시', () => {
    renderBaedaejiPanel(
      [
        order({ id: 'a', productName: '피규어', price: { amount: 3850, currency: 'JPY' }, orderNumber: 'A-1' }),
        order({ id: 'b', productName: '셔츠' }),
      ],
      () => {},
    );
    const panel = document.getElementById('zoas-baedaeji-panel')!;
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('피규어');
    expect(panel.textContent).toContain('3850 JPY');
    expect(panel.textContent).toContain('#A-1');
    expect(panel.textContent).toContain('주문번호 미확정'); // 셔츠는 orderNumber 없음
    expect(panel.textContent).toContain('검토 후 직접 제출');
  });

  it('채우기 버튼 클릭 시 해당 주문으로 콜백', () => {
    const onFill = vi.fn();
    const a = order({ id: 'a', productName: '피규어' });
    renderBaedaejiPanel([a], onFill);
    const btn = document.querySelector<HTMLButtonElement>('#zoas-baedaeji-panel button:last-of-type')!;
    // 마지막 버튼은 힌트 아님 — 채우기 버튼을 텍스트로 특정
    const fillBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#zoas-baedaeji-panel button'),
    ).find((b) => b.textContent === '채우기')!;
    fillBtn.click();
    expect(onFill).toHaveBeenCalledWith(a);
    expect(btn).toBeTruthy();
  });

  it('주문이 없으면 빈 상태 문구', () => {
    renderBaedaejiPanel([], () => {});
    expect(document.getElementById('zoas-baedaeji-panel')!.textContent).toContain(
      '채울 주문이 없습니다',
    );
  });

  it('닫기 버튼으로 패널 제거', () => {
    renderBaedaejiPanel([order({ id: 'a' })], () => {});
    const close = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#zoas-baedaeji-panel button'),
    ).find((b) => b.getAttribute('aria-label') === '닫기')!;
    close.click();
    expect(document.getElementById('zoas-baedaeji-panel')).toBeNull();
  });

  it('재렌더 시 중복 없이 하나만 유지', () => {
    renderBaedaejiPanel([order({ id: 'a' })], () => {});
    renderBaedaejiPanel([order({ id: 'b' })], () => {});
    expect(document.querySelectorAll('#zoas-baedaeji-panel').length).toBe(1);
  });
});
