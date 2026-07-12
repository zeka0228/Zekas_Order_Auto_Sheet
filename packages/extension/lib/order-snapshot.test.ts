import { describe, expect, it } from 'vitest';
import { buildPendingOrder, buildManualOrder } from './order-snapshot';

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

describe('buildManualOrder', () => {
  it('상품명·금액·통화·주문번호를 manual 주문으로 저장', () => {
    const order = buildManualOrder({
      id: 'm-1',
      productName: '  피규어 한정판  ',
      amount: 3850,
      currency: 'JPY',
      orderNumber: ' ORD-9 ',
      now: 1234,
    });
    expect(order.source).toBe('manual');
    expect(order.domain).toBe('manual');
    expect(order.productName).toBe('피규어 한정판'); // trim
    expect(order.price).toEqual({ amount: 3850, currency: 'JPY' });
    expect(order.orderNumber).toBe('ORD-9'); // trim
    expect(order.needsHumanReview).toBe(false);
    expect(order.capturedAt).toBe(1234);
  });

  it('금액 없으면 price 생략 + needsHumanReview=true', () => {
    const order = buildManualOrder({ id: 'm-2', productName: '셔츠', now: 1 });
    expect(order.price).toBeUndefined();
    expect(order.needsHumanReview).toBe(true);
    expect(order.orderNumber).toBeUndefined();
  });

  it('통화 없이 금액만 있으면 price 생략(둘 다 있어야 함)', () => {
    const order = buildManualOrder({ id: 'm-3', productName: '가방', amount: 20, now: 1 });
    expect(order.price).toBeUndefined();
  });

  it('빈 주문번호는 undefined로 정규화', () => {
    const order = buildManualOrder({
      id: 'm-4',
      productName: '모자',
      orderNumber: '   ',
      now: 1,
    });
    expect(order.orderNumber).toBeUndefined();
  });
});
