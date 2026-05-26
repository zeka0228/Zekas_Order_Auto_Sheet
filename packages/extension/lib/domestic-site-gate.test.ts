import { describe, expect, it } from 'vitest';
import { isDomesticSite } from './domestic-site-gate';

function docWithText(text: string): Document {
  return new DOMParser().parseFromString(`<body>${text}</body>`, 'text/html');
}

describe('isDomesticSite — 메인 신호 (법정표시 단독 차단)', () => {
  it('"통신판매업신고" 문구만 있어도 차단', () => {
    const doc = docWithText('통신판매업신고 제2024-서울강남-12345호');
    expect(isDomesticSite(doc, 'https://example.com/checkout')).toBe(true);
  });

  it('"통신판매업 신고" (공백 포함)도 차단', () => {
    const doc = docWithText('통신판매업 신고 제2024-서울강남-12345호');
    expect(isDomesticSite(doc, 'https://example.com/checkout')).toBe(true);
  });

  it('사업자등록번호 패턴(XXX-XX-XXXXX)만 있어도 차단', () => {
    const doc = docWithText('사업자등록번호: 123-45-67890');
    expect(isDomesticSite(doc, 'https://example.com/checkout')).toBe(true);
  });

  it('사업자등록번호 패턴(하이픈 없음)도 차단', () => {
    const doc = docWithText('사업자등록번호 1234567890');
    expect(isDomesticSite(doc, 'https://example.com/checkout')).toBe(true);
  });
});

describe('isDomesticSite — 보조 조합 (결제수단 AND 도메인)', () => {
  it('카카오페이 + .kr 도메인이면 차단', () => {
    const doc = docWithText('카카오페이로 결제');
    expect(isDomesticSite(doc, 'https://shop.example.kr/order')).toBe(true);
  });

  it('네이버페이 + coupang.com이면 차단', () => {
    const doc = docWithText('네이버페이 결제');
    expect(isDomesticSite(doc, 'https://www.coupang.com/cart')).toBe(true);
  });

  it('무통장입금 + .co.kr이면 차단', () => {
    const doc = docWithText('무통장입금 안내');
    expect(isDomesticSite(doc, 'https://shop.example.co.kr/pay')).toBe(true);
  });

  it('smartstore.naver.com 같은 서브도메인도 도메인 신호로 인식', () => {
    const doc = docWithText('토스페이로 결제');
    expect(isDomesticSite(doc, 'https://smartstore.naver.com/foo/order')).toBe(true);
  });
});

describe('isDomesticSite — 단일 보조 신호로는 차단 안 함', () => {
  it('.kr 도메인만 있고 결제수단·법정표시 없으면 false', () => {
    const doc = docWithText('상품 페이지');
    expect(isDomesticSite(doc, 'https://example.kr/product/1')).toBe(false);
  });

  it('카카오페이만 있고 해외 도메인이면 false (한국어 결제 가능한 해외 사이트 보호)', () => {
    const doc = docWithText('카카오페이로 결제 가능');
    expect(isDomesticSite(doc, 'https://shop.example.com/checkout')).toBe(false);
  });

  it('coupang.com 도메인만 있고 본문 신호 없으면 false', () => {
    const doc = docWithText('빈 페이지');
    expect(isDomesticSite(doc, 'https://www.coupang.com/cart')).toBe(false);
  });
});

describe('isDomesticSite — 해외→국내 오판 방지 (false negative 보호)', () => {
  it('asobistore.jp는 false', () => {
    const doc = docWithText('お支払い方法を選択してください');
    expect(isDomesticSite(doc, 'https://shop.asobistore.jp/checkout')).toBe(false);
  });

  it('amazon.co.jp는 false', () => {
    const doc = docWithText('注文を確定する');
    expect(isDomesticSite(doc, 'https://www.amazon.co.jp/checkout')).toBe(false);
  });

  it('한국어로 번역된 해외 쇼핑몰(Shopify 등)은 결제수단·법정표시 없으면 false', () => {
    const doc = docWithText('주문 확인 — 한국어 페이지');
    expect(isDomesticSite(doc, 'https://shop.example.com/cart')).toBe(false);
  });

  it('잘못된 URL이어도 본문에 법정표시 있으면 차단 (URL 파싱 실패가 본문 신호를 무력화하지 않음)', () => {
    const doc = docWithText('사업자등록번호 123-45-67890');
    expect(isDomesticSite(doc, 'not-a-valid-url')).toBe(true);
  });

  it('잘못된 URL + 본문 신호 없으면 false', () => {
    const doc = docWithText('상품 페이지');
    expect(isDomesticSite(doc, 'not-a-valid-url')).toBe(false);
  });
});
