import { describe, expect, it } from 'vitest';
import {
  saveSnapshot,
  consumeSnapshot,
  mergeCapture,
  buildPendingOrder,
} from './order-snapshot';
import type { ParsedFields } from './checkout-parser';

/** chrome.storage.StorageArea의 최소 인메모리 가짜 (get/set/remove만). */
function fakeArea(): chrome.storage.StorageArea & { store: Record<string, unknown> } {
  const store: Record<string, unknown> = {};
  return {
    store,
    async get(key: string) {
      return key in store ? { [key]: store[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, items);
    },
    async remove(key: string) {
      delete store[key];
    },
  } as unknown as chrome.storage.StorageArea & { store: Record<string, unknown> };
}

const fields: ParsedFields = {
  productName: 'フィギュア',
  price: { amount: 3850, currency: 'JPY' },
};

describe('saveSnapshot / consumeSnapshot', () => {
  it('저장 후 소비하면 필드를 돌려준다', async () => {
    const area = fakeArea();
    await saveSnapshot('shop.jp', 'https://shop.jp/checkout', fields, 1000, area);
    const got = await consumeSnapshot('shop.jp', 1000, area);
    expect(got).toEqual(fields);
  });

  it('consume-once: 한 번 소비하면 사라진다', async () => {
    const area = fakeArea();
    await saveSnapshot('shop.jp', 'u', fields, 1000, area);
    await consumeSnapshot('shop.jp', 1000, area);
    const second = await consumeSnapshot('shop.jp', 1000, area);
    expect(second).toBeNull();
  });

  it('덮어쓰기: 다시 저장하면 마지막 클릭이 이긴다', async () => {
    const area = fakeArea();
    await saveSnapshot('shop.jp', 'u', { productName: '구버전' }, 1000, area);
    await saveSnapshot('shop.jp', 'u', { productName: '신버전' }, 2000, area);
    const got = await consumeSnapshot('shop.jp', 2000, area);
    expect(got).toEqual({ productName: '신버전' });
  });

  it('TTL 초과 스냅샷은 무시(null)하되 삭제는 된다', async () => {
    const area = fakeArea();
    await saveSnapshot('shop.jp', 'u', fields, 0, area);
    const got = await consumeSnapshot('shop.jp', 31 * 60_000, area); // 31분 후
    expect(got).toBeNull();
    expect(Object.keys(area.store)).toHaveLength(0); // 그래도 삭제됨
  });

  it('도메인별로 분리된다', async () => {
    const area = fakeArea();
    await saveSnapshot('a.com', 'u', { productName: 'A' }, 1000, area);
    await saveSnapshot('b.com', 'u', { productName: 'B' }, 1000, area);
    expect(await consumeSnapshot('a.com', 1000, area)).toEqual({ productName: 'A' });
    expect(await consumeSnapshot('b.com', 1000, area)).toEqual({ productName: 'B' });
  });
});

describe('mergeCapture', () => {
  it('base 우선, snap이 빈 필드 보충', () => {
    const base: ParsedFields = { orderNumber: 'ORD-1' }; // 완료 페이지: 주문번호만
    const snap: ParsedFields = {
      productName: 'フィギュア',
      price: { amount: 3850, currency: 'JPY' },
    };
    expect(mergeCapture(base, snap)).toEqual({
      orderNumber: 'ORD-1',
      productName: 'フィギュア',
      price: { amount: 3850, currency: 'JPY' },
    });
  });

  it('base에 값이 있으면 snap이 덮지 못한다', () => {
    const base: ParsedFields = { productName: '완료페이지명' };
    const snap: ParsedFields = { productName: '스냅샷명' };
    expect(mergeCapture(base, snap).productName).toBe('완료페이지명');
  });

  it('snap이 null이면 base 복사', () => {
    const base: ParsedFields = { orderNumber: 'ORD-1' };
    expect(mergeCapture(base, null)).toEqual({ orderNumber: 'ORD-1' });
  });
});

describe('buildPendingOrder', () => {
  const args = {
    id: 'id-1',
    domain: 'shop.jp',
    url: 'https://shop.jp/complete',
    now: 1234,
  };

  it('핵심 필드 모두 있으면 needsHumanReview=false', () => {
    const order = buildPendingOrder({
      ...args,
      fields: {
        orderNumber: 'ORD-1',
        productName: 'フィギュア',
        price: { amount: 3850, currency: 'JPY' },
      },
    });
    expect(order.needsHumanReview).toBe(false);
    expect(order.source).toBe('checkout');
    expect(order.capturedAt).toBe(1234);
    expect(order.orderNumber).toBe('ORD-1');
  });

  it('주문번호가 없으면 needsHumanReview=true', () => {
    const order = buildPendingOrder({
      ...args,
      fields: { productName: 'X', price: { amount: 1, currency: 'JPY' } },
    });
    expect(order.needsHumanReview).toBe(true);
  });

  it('가격이 없으면 needsHumanReview=true', () => {
    const order = buildPendingOrder({
      ...args,
      fields: { orderNumber: 'ORD-1', productName: 'X' },
    });
    expect(order.needsHumanReview).toBe(true);
  });
});
