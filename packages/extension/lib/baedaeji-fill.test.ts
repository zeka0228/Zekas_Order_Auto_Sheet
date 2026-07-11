import { describe, expect, it } from 'vitest';
import { orderToBaedaejiValues, fillOrderIntoForm } from './baedaeji-fill';
import {
  PendingOrderSchema,
  SiteConfigSchema,
  type PendingOrder,
  type SiteConfig,
} from './schemas';

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function config(selectors: Record<string, string>): SiteConfig {
  return SiteConfigSchema.parse({
    id: 1,
    type: 'baedaeji',
    domain: 'baedaeji.example.kr',
    urlPattern: '*',
    version: 1,
    selectors,
  });
}

function order(partial: Partial<PendingOrder>): PendingOrder {
  return PendingOrderSchema.parse({
    id: 'id-1',
    domain: 'shop.example.com',
    url: 'https://shop.example.com/checkout',
    capturedAt: 1_700_000_000_000,
    source: 'checkout',
    ...partial,
  });
}

describe('orderToBaedaejiValues', () => {
  it('상품명·가격·통화·주문번호를 배대지 필드로 매핑', () => {
    const values = orderToBaedaejiValues(
      order({
        orderNumber: 'A-1001',
        productName: 'フィギュア 限定版',
        price: { amount: 3850, currency: 'JPY' },
      }),
    );
    expect(values).toEqual({
      trackingNumber: 'A-1001',
      productName: 'フィギュア 限定版',
      declaredPrice: '3850',
      currency: 'JPY',
    });
  });

  it('가격이 없으면 declaredPrice·currency 생략(undefined)', () => {
    const values = orderToBaedaejiValues(
      order({ orderNumber: 'B-2', productName: '셔츠' }),
    );
    expect(values.declaredPrice).toBeUndefined();
    expect(values.currency).toBeUndefined();
    expect(values.productName).toBe('셔츠');
    expect(values.trackingNumber).toBe('B-2');
  });

  it('orderNumber 미백필(후보) 상태면 trackingNumber undefined', () => {
    const values = orderToBaedaejiValues(
      order({ productName: '가방', price: { amount: 20, currency: 'USD' } }),
    );
    expect(values.trackingNumber).toBeUndefined();
    expect(values.declaredPrice).toBe('20');
    expect(values.currency).toBe('USD');
  });

  it('소수점 가격도 문자열로 변환', () => {
    const values = orderToBaedaejiValues(
      order({ price: { amount: 1299.99, currency: 'USD' } }),
    );
    expect(values.declaredPrice).toBe('1299.99');
  });
});

describe('fillOrderIntoForm', () => {
  it('config 셀렉터로 폼을 채우고 report 반환', () => {
    const doc = docFrom(`
      <form>
        <input id="t" />
        <input id="p" />
        <input id="d" type="number" />
      </form>`);
    const cfg = config({ trackingNumber: '#t', productName: '#p', declaredPrice: '#d' });
    const report = fillOrderIntoForm(
      doc,
      cfg,
      order({
        orderNumber: 'A-1001',
        productName: '피규어',
        price: { amount: 3850, currency: 'JPY' },
      }),
    );
    expect(doc.querySelector<HTMLInputElement>('#t')!.value).toBe('A-1001');
    expect(doc.querySelector<HTMLInputElement>('#p')!.value).toBe('피규어');
    expect(doc.querySelector<HTMLInputElement>('#d')!.value).toBe('3850');
    expect(report.filled.sort()).toEqual(
      ['declaredPrice', 'productName', 'trackingNumber'].sort(),
    );
  });

  it('config에 셀렉터가 없는 필드는 missing으로 검토 유도', () => {
    const doc = docFrom('<form><input id="p" /></form>');
    const cfg = config({ productName: '#p' }); // trackingNumber 셀렉터 없음
    const report = fillOrderIntoForm(
      doc,
      cfg,
      order({ orderNumber: 'A-1', productName: '셔츠' }),
    );
    expect(report.filled).toEqual(['productName']);
    expect(report.missing).toEqual(['trackingNumber']);
  });
});
