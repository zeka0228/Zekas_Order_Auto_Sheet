import { describe, expect, it } from 'vitest';
import { looksLikeCheckoutOrCompletion, decidePageRole } from './checkout-flow';

function docWithText(text: string): Document {
  return new DOMParser().parseFromString(`<body>${text}</body>`, 'text/html');
}

describe('looksLikeCheckoutOrCompletion', () => {
  it.each([
    'https://shop.asobistore.jp/checkout',
    'https://shop.asobistore.jp/order/complete',
    'https://shop.example.com/cart',
    'https://shop.jp/注文確認',
    'https://shop.kr/결제',
  ])('URL 키워드로 통과: %s', (url) => {
    expect(looksLikeCheckoutOrCompletion(docWithText(''), url)).toBe(true);
  });

  it.each([
    ['주문번호: ORD-1', 'https://shop.jp/random'],
    ['注文番号 12345', 'https://x.jp/p'],
    ['Order Number 999', 'https://x.com/p'],
  ])('본문 텍스트로 통과: %s', (text, url) => {
    expect(looksLikeCheckoutOrCompletion(docWithText(text), url)).toBe(true);
  });

  it('관련 없는 페이지는 false', () => {
    expect(
      looksLikeCheckoutOrCompletion(docWithText('블로그 글 본문'), 'https://blog.jp/post/1'),
    ).toBe(false);
  });
});

describe('decidePageRole', () => {
  it('주문번호가 있으면 completion (payButton 여부 무관)', () => {
    expect(decidePageRole({ hasOrderNumber: true, hasPayButton: false })).toBe('completion');
    expect(decidePageRole({ hasOrderNumber: true, hasPayButton: true })).toBe('completion');
  });

  it('주문번호 없고 payButton 있으면 prepay', () => {
    expect(decidePageRole({ hasOrderNumber: false, hasPayButton: true })).toBe('prepay');
  });

  it('둘 다 없으면 none', () => {
    expect(decidePageRole({ hasOrderNumber: false, hasPayButton: false })).toBe('none');
  });
});
