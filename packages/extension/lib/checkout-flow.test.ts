import { describe, expect, it } from 'vitest';
import {
  looksLikeCheckoutOrCompletion,
  decidePageRole,
  isCartPage,
  hasCartPriceSignal,
} from './checkout-flow';

function docWithText(text: string): Document {
  return new DOMParser().parseFromString(`<body>${text}</body>`, 'text/html');
}

describe('looksLikeCheckoutOrCompletion — URL 키워드', () => {
  it.each([
    'https://shop.asobistore.jp/checkout',
    'https://shop.asobistore.jp/order/complete',
    'https://shop.example.com/cart',
    'https://shop.example.com/basket',
    'https://shop.example.com/bag',
    'https://shop.example.com/trolley',
    'https://shop.example.com/shopping-cart',
    'https://shop.jp/注文確認',
    'https://shop.kr/결제',
    // 중국어 간체·번체 추가 케이스
    'https://shop.cn/购物车',
    'https://shop.cn/结算',
    'https://shop.cn/订单/12345',
    'https://shop.tw/購物車',
    'https://shop.tw/結算',
    'https://shop.tw/訂單/12345',
  ])('URL 키워드로 통과: %s', (url) => {
    expect(looksLikeCheckoutOrCompletion(docWithText(''), url)).toBe(true);
  });
});

describe('looksLikeCheckoutOrCompletion — 본문 텍스트', () => {
  it.each([
    ['주문번호: ORD-1', 'https://shop.jp/random'],
    ['注文番号 12345', 'https://x.jp/p'],
    ['Order Number 999', 'https://x.com/p'],
    ['您的订单 12345', 'https://x.cn/p'],
    ['您的訂單 12345', 'https://x.tw/p'],
    ['感谢您的购买', 'https://x.cn/p'],
  ])('본문 텍스트로 통과: %s', (text, url) => {
    expect(looksLikeCheckoutOrCompletion(docWithText(text), url)).toBe(true);
  });

  it('관련 없는 페이지는 false', () => {
    expect(
      looksLikeCheckoutOrCompletion(docWithText('블로그 글 본문'), 'https://blog.jp/post/1'),
    ).toBe(false);
  });
});

describe('isCartPage', () => {
  it.each([
    'https://shop.example.com/cart',
    'https://shop.example.com/cart/',
    'https://shop.example.com/cart?step=1',
    'https://shop.example.com/cart#section',
    'https://shop.example.com/basket',
    'https://shop.example.com/bag',
    'https://shop.example.com/trolley',
    'https://shop.example.com/shopping-cart',
    'https://shop.example.com/shopping_cart',
    'https://shop.example.com/shoppingcart',
    'https://shop.example.com/checkout/cart', // Magento 표준
    'https://shop.example.com/minicart',
    'https://shop.cn/购物车',
    'https://shop.tw/購物車',
    'https://shop.jp/カート',
    'https://shop.kr/장바구니',
  ])('장바구니 URL: %s', (url) => {
    expect(isCartPage(url)).toBe(true);
  });

  it.each([
    'https://shop.example.com/checkout',
    'https://shop.example.com/payment',
    'https://shop.example.com/order/complete',
    'https://shop.example.com/thank-you',
    'https://shop.example.com/product/12345',
    'https://shop.example.com/category/electronics',
    'https://shop.example.com/',
    // /cartoon 같은 부분 일치는 잡으면 안 됨 (단어 경계)
    'https://shop.example.com/cartoon',
    'https://shop.example.com/discard-bag',
  ])('장바구니 아님: %s', (url) => {
    expect(isCartPage(url)).toBe(false);
  });
});

describe('hasCartPriceSignal — 빈 카트 vs 셀렉터 stale 구분용', () => {
  it.each([
    '¥300',
    '$30.99',
    '€12,50',
    '₩30,000',
    '£99',
    '300円',
    '30,000원',
    '100元',
    '여러 상품 ¥300 + ¥150 = ¥450',
  ])('가격 패턴 hit: %s', (text) => {
    expect(hasCartPriceSignal(docWithText(text))).toBe(true);
  });

  it.each([
    '장바구니가 비어 있습니다',
    'Your cart is empty',
    'カートに商品がありません',
    '购物车为空',
    '상품을 추가해 주세요',
  ])('빈 카트 텍스트는 false: %s', (text) => {
    expect(hasCartPriceSignal(docWithText(text))).toBe(false);
  });

  it('숫자만 있고 통화 표기 없으면 false (전화번호·재고 등)', () => {
    expect(hasCartPriceSignal(docWithText('재고 12개, 평점 5'))).toBe(false);
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
