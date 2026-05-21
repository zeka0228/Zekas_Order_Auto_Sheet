import { describe, expect, it } from 'vitest';
import {
  parsePrice,
  parseWithSelectors,
  hasCriticalFields,
} from './checkout-parser';

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('parsePrice', () => {
  it.each([
    ['¥3,850', 3850, 'JPY'],
    ['3,850円', 3850, 'JPY'],
    ['$1,299.99', 1299.99, 'USD'],
    ['€49,90', 4990, 'EUR'], // 통화기호로 EUR 판정, 금액은 숫자 그대로
    ['₩12,000', 12000, 'KRW'],
    ['12,000원', 12000, 'KRW'],
    ['£20', 20, 'GBP'],
    ['元 88', 88, 'CNY'],
  ])('"%s" → %d %s', (text, amount, currency) => {
    expect(parsePrice(text)).toEqual({ amount, currency });
  });

  it('숫자가 없으면 null', () => {
    expect(parsePrice('Free')).toBeNull();
    expect(parsePrice('무료')).toBeNull();
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('   ')).toBeNull();
  });

  it('통화기호가 없으면 currency는 UNK', () => {
    expect(parsePrice('3850')).toEqual({ amount: 3850, currency: 'UNK' });
  });
});

describe('parseWithSelectors', () => {
  const html = `
    <div class="order">
      <span class="onum">A10232025092202215</span>
      <h1 class="pname">フィギュア 限定版</h1>
      <span class="amt">¥3,850</span>
    </div>`;
  const selectors = {
    orderNumber: '.onum',
    productName: '.pname',
    price: '.amt',
  };

  it('셀렉터로 모든 필드 추출', () => {
    const out = parseWithSelectors(docFrom(html), selectors);
    expect(out).toEqual({
      orderNumber: 'A10232025092202215',
      productName: 'フィギュア 限定版',
      price: { amount: 3850, currency: 'JPY' },
    });
  });

  it('일부 셀렉터만 매칭되면 부분 결과 (완료 페이지가 주문번호만 가진 경우)', () => {
    const out = parseWithSelectors(docFrom('<span class="onum">X-1</span>'), selectors);
    expect(out).toEqual({ orderNumber: 'X-1' });
  });

  it('selectors에 키가 없으면 그 필드는 생략', () => {
    const out = parseWithSelectors(docFrom(html), { price: '.amt' });
    expect(out).toEqual({ price: { amount: 3850, currency: 'JPY' } });
  });

  it('빈/공백 텍스트는 필드로 채우지 않음', () => {
    const out = parseWithSelectors(
      docFrom('<span class="onum">   </span>'),
      selectors,
    );
    expect(out.orderNumber).toBeUndefined();
  });

  it('잘못된 셀렉터 문자열도 throw하지 않고 무시 (깨진 AI 셀렉터 방어)', () => {
    const out = parseWithSelectors(docFrom(html), {
      orderNumber: ':::not-a-selector',
      price: '.amt',
    });
    expect(out.orderNumber).toBeUndefined();
    expect(out.price).toEqual({ amount: 3850, currency: 'JPY' });
  });

  it('가격 텍스트에 숫자가 없으면 price 생략', () => {
    const out = parseWithSelectors(docFrom('<span class="amt">Free</span>'), {
      price: '.amt',
    });
    expect(out.price).toBeUndefined();
  });
});

describe('hasCriticalFields', () => {
  it('상품명·가격 모두 있으면 true', () => {
    expect(
      hasCriticalFields({ productName: 'X', price: { amount: 1, currency: 'JPY' } }),
    ).toBe(true);
  });
  it('하나라도 없으면 false', () => {
    expect(hasCriticalFields({ productName: 'X' })).toBe(false);
    expect(hasCriticalFields({ price: { amount: 1, currency: 'JPY' } })).toBe(false);
    expect(hasCriticalFields({})).toBe(false);
  });
});
