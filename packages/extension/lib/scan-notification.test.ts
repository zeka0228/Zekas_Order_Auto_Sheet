import { afterEach, describe, expect, it, vi } from 'vitest';
import { showScanNotification, hideScanNotification } from './scan-notification';

const TOAST_ID = 'zoas-scan-toast';

afterEach(() => {
  document.getElementById(TOAST_ID)?.remove();
  vi.useRealTimers();
});

describe('showScanNotification', () => {
  it('toast 엘리먼트를 documentElement에 주입', () => {
    showScanNotification('recognized', 0);
    const toast = document.getElementById(TOAST_ID);
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain('해외 사이트 주문 인식');
    expect(toast?.textContent).toContain('ZOAS');
  });

  it('상태별 텍스트 — scanning', () => {
    showScanNotification('scanning', 0);
    expect(document.getElementById(TOAST_ID)?.textContent).toContain('스캔 진행 중');
  });

  it('상태별 텍스트 — completed', () => {
    showScanNotification('completed', 0);
    expect(document.getElementById(TOAST_ID)?.textContent).toContain('스캔 완료');
  });

  it('상태별 텍스트 — error', () => {
    showScanNotification('error', 0);
    expect(document.getElementById(TOAST_ID)?.textContent).toContain('스캔 실패');
  });

  it('연속 호출 시 이전 toast를 갈아끼움 (DOM에 항상 1개만)', () => {
    showScanNotification('recognized', 0);
    showScanNotification('scanning', 0);
    showScanNotification('completed', 0);
    expect(document.querySelectorAll(`#${TOAST_ID}`)).toHaveLength(1);
    expect(document.getElementById(TOAST_ID)?.textContent).toContain('스캔 완료');
  });

  it('autoHideMs > 0 이면 타이머 종료 후 toast 사라짐', () => {
    vi.useFakeTimers();
    showScanNotification('recognized', 1000);
    expect(document.getElementById(TOAST_ID)).not.toBeNull();
    vi.advanceTimersByTime(1000);
    // 페이드 아웃 250ms 후 remove
    vi.advanceTimersByTime(300);
    expect(document.getElementById(TOAST_ID)).toBeNull();
  });

  it('autoHideMs=0 이면 자동 hide 안 함', () => {
    vi.useFakeTimers();
    showScanNotification('recognized', 0);
    vi.advanceTimersByTime(10_000);
    expect(document.getElementById(TOAST_ID)).not.toBeNull();
  });

  it('toast 스타일에 매우 높은 z-index 적용 (페이지 위에 보장)', () => {
    showScanNotification('recognized', 0);
    const toast = document.getElementById(TOAST_ID);
    expect(toast?.getAttribute('style')).toContain('z-index: 2147483647');
  });

  it('toast는 pointer-events: none — 사용자 클릭을 방해하지 않음', () => {
    showScanNotification('recognized', 0);
    const toast = document.getElementById(TOAST_ID);
    expect(toast?.getAttribute('style')).toContain('pointer-events: none');
  });
});

describe('hideScanNotification', () => {
  it('toast가 있으면 페이드 아웃 후 제거', () => {
    vi.useFakeTimers();
    showScanNotification('recognized', 0);
    hideScanNotification();
    vi.advanceTimersByTime(300);
    expect(document.getElementById(TOAST_ID)).toBeNull();
  });

  it('toast가 없을 때 호출해도 throw 안 함', () => {
    expect(() => hideScanNotification()).not.toThrow();
  });
});
