import { describe, expect, it } from 'vitest';
import { fillFormFields } from './form-fill';

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('fillFormFields', () => {
  const selectors = {
    trackingNumber: '#tracking',
    productName: '#pname',
    declaredPrice: '#price',
    currency: '#cur',
    quantity: '#qty',
  };

  it('input/textarea에 값 주입 + filled 리포트', () => {
    const doc = docFrom(`
      <form>
        <input id="tracking" />
        <textarea id="pname"></textarea>
        <input id="price" type="number" />
      </form>`);
    const report = fillFormFields(doc, selectors, {
      trackingNumber: 'A-1001',
      productName: 'フィギュア 限定版',
      declaredPrice: '3850',
    });
    expect(doc.querySelector<HTMLInputElement>('#tracking')!.value).toBe('A-1001');
    expect(doc.querySelector<HTMLTextAreaElement>('#pname')!.value).toBe(
      'フィギュア 限定版',
    );
    expect(doc.querySelector<HTMLInputElement>('#price')!.value).toBe('3850');
    expect(report.filled.sort()).toEqual(
      ['declaredPrice', 'productName', 'trackingNumber'].sort(),
    );
    expect(report.missing).toEqual([]);
  });

  it('input/change 이벤트를 발생시켜 controlled 폼과 호환', () => {
    const doc = docFrom('<input id="tracking" />');
    const el = doc.querySelector<HTMLInputElement>('#tracking')!;
    let inputs = 0;
    let changes = 0;
    el.addEventListener('input', () => (inputs += 1));
    el.addEventListener('change', () => (changes += 1));
    fillFormFields(doc, { trackingNumber: '#tracking' }, { trackingNumber: 'X' });
    expect(inputs).toBe(1);
    expect(changes).toBe(1);
  });

  it('빈/공백/undefined 값은 시도하지 않음 (리포트에도 없음)', () => {
    const doc = docFrom('<input id="tracking" /><input id="pname" />');
    const report = fillFormFields(doc, selectors, {
      trackingNumber: '   ',
      productName: undefined,
    });
    expect(report.filled).toEqual([]);
    expect(report.missing).toEqual([]);
    expect(doc.querySelector<HTMLInputElement>('#tracking')!.value).toBe('');
  });

  it('셀렉터 미설정이면 missing', () => {
    const doc = docFrom('<input id="tracking" />');
    const report = fillFormFields(doc, {}, { trackingNumber: 'A-1' });
    expect(report.missing).toEqual(['trackingNumber']);
    expect(report.filled).toEqual([]);
  });

  it('셀렉터가 요소를 못 찾으면 missing', () => {
    const doc = docFrom('<div></div>');
    const report = fillFormFields(doc, selectors, { trackingNumber: 'A-1' });
    expect(report.missing).toEqual(['trackingNumber']);
  });

  it('잘못된 셀렉터 문자열도 throw하지 않고 missing', () => {
    const doc = docFrom('<input id="tracking" />');
    const report = fillFormFields(
      doc,
      { trackingNumber: ':::bad' },
      { trackingNumber: 'A-1' },
    );
    expect(report.missing).toEqual(['trackingNumber']);
  });

  it('채우면 안 되는 input type(checkbox/file/submit)은 missing', () => {
    const doc = docFrom(`
      <input id="a" type="checkbox" />
      <input id="b" type="file" />
      <input id="c" type="submit" />`);
    const report = fillFormFields(
      doc,
      { a: '#a', b: '#b', c: '#c' },
      { a: 'x', b: 'y', c: 'z' },
    );
    expect(report.filled).toEqual([]);
    expect(report.missing.sort()).toEqual(['a', 'b', 'c']);
  });

  describe('select', () => {
    const html = `
      <select id="cur">
        <option value="">선택</option>
        <option value="JPY">엔화</option>
        <option value="USD">달러</option>
      </select>`;

    it('option value로 매칭', () => {
      const doc = docFrom(html);
      const report = fillFormFields(doc, { currency: '#cur' }, { currency: 'JPY' });
      expect(doc.querySelector<HTMLSelectElement>('#cur')!.value).toBe('JPY');
      expect(report.filled).toEqual(['currency']);
    });

    it('option 표시 텍스트로 매칭 (value가 아니라 라벨로)', () => {
      const doc = docFrom(html);
      const report = fillFormFields(doc, { currency: '#cur' }, { currency: '달러' });
      expect(doc.querySelector<HTMLSelectElement>('#cur')!.value).toBe('USD');
      expect(report.filled).toEqual(['currency']);
    });

    it('대소문자 무시 텍스트 매칭', () => {
      const doc = docFrom(`
        <select id="cat">
          <option value="1">Clothing</option>
          <option value="2">Electronics</option>
        </select>`);
      const report = fillFormFields(
        doc,
        { productCategory: '#cat' },
        { productCategory: 'electronics' },
      );
      expect(doc.querySelector<HTMLSelectElement>('#cat')!.value).toBe('2');
      expect(report.filled).toEqual(['productCategory']);
    });

    it('매칭 option이 없으면 missing (값 변경 안 함 — 사용자 선택)', () => {
      const doc = docFrom(html);
      const report = fillFormFields(
        doc,
        { currency: '#cur' },
        { currency: 'EUR' },
      );
      expect(doc.querySelector<HTMLSelectElement>('#cur')!.value).toBe('');
      expect(report.missing).toEqual(['currency']);
      expect(report.filled).toEqual([]);
    });
  });
});
