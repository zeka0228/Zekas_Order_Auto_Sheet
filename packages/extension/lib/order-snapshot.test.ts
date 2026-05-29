import { describe, expect, it } from 'vitest';
import { buildPendingOrder } from './order-snapshot';

describe('buildPendingOrder', () => {
  const args = {
    id: 'id-1',
    domain: 'shop.jp',
    url: 'https://shop.jp/checkout',
    now: 1234,
  };

  it('상품·가격 모두 있으면 needsHumanReview=false (orderNumber 없어도 OK — 이메일 백필)', () => {
    const order = buildPendingOrder({
      ...args,
      fields: {
        productName: 'フィギュア',
        price: { amount: 3850, currency: 'JPY' },
      },
    });
    expect(order.needsHumanReview).toBe(false);
    expect(order.source).toBe('checkout');
    expect(order.capturedAt).toBe(1234);
    expect(order.orderNumber).toBeUndefined();
  });

  it('orderNumber가 있으면 그대로 보존한다', () => {
    const order = buildPendingOrder({
      ...args,
      fields: {
        orderNumber: 'ORD-1',
        productName: 'X',
        price: { amount: 1, currency: 'JPY' },
      },
    });
    expect(order.orderNumber).toBe('ORD-1');
    expect(order.needsHumanReview).toBe(false);
  });

  it('상품명이 없으면 needsHumanReview=true', () => {
    const order = buildPendingOrder({
      ...args,
      fields: { price: { amount: 1, currency: 'JPY' } },
    });
    expect(order.needsHumanReview).toBe(true);
  });

  it('가격이 없으면 needsHumanReview=true', () => {
    const order = buildPendingOrder({
      ...args,
      fields: { productName: 'X' },
    });
    expect(order.needsHumanReview).toBe(true);
  });
});
