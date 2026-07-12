import { describe, expect, it } from 'vitest';
import {
  looksLikeBaedaejiForm,
  isRegisteredBaedaejiDomain,
  hasFillableForm,
  shouldActivateBaedaeji,
} from './baedaeji-gate';

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const formHtml = `
  <h1>해외배송 신청</h1>
  <p>개인통관고유부호를 입력하세요</p>
  <form>
    <input name="a" />
    <input name="b" />
    <select name="c"><option>x</option></select>
    <textarea name="d"></textarea>
  </form>`;

describe('isRegisteredBaedaejiDomain', () => {
  it('등록 도메인과 핵심 라벨이 같으면 true (서브도메인·www·경로 무시)', () => {
    const reg = ['malltail.com'];
    expect(isRegisteredBaedaejiDomain('www.malltail.com', reg)).toBe(true);
    expect(isRegisteredBaedaejiDomain('order.malltail.com', reg)).toBe(true);
    expect(isRegisteredBaedaejiDomain('malltail.com', reg)).toBe(true);
  });

  it('등록 항목이 URL 형태여도 정규화해서 매칭', () => {
    expect(
      isRegisteredBaedaejiDomain('www.malltail.com', ['https://malltail.com/order/new']),
    ).toBe(true);
  });

  it('다른 도메인이면 false', () => {
    expect(isRegisteredBaedaejiDomain('shop.asobistore.jp', ['malltail.com'])).toBe(false);
  });

  it('등록 목록이 비면 false', () => {
    expect(isRegisteredBaedaejiDomain('malltail.com', [])).toBe(false);
  });
});

describe('hasFillableForm', () => {
  it('채울 수 있는 필드 3개 이상이면 true', () => {
    expect(hasFillableForm(docFrom(formHtml))).toBe(true);
  });

  it('버튼·체크박스류만 있으면 false', () => {
    const html = `<form>
      <input type="checkbox" /><input type="submit" /><input type="button" />
    </form>`;
    expect(hasFillableForm(docFrom(html))).toBe(false);
  });

  it('min 인자로 임계값 조정', () => {
    expect(hasFillableForm(docFrom('<input /><input />'), 2)).toBe(true);
    expect(hasFillableForm(docFrom('<input /><input />'), 3)).toBe(false);
  });
});

describe('shouldActivateBaedaeji', () => {
  it('등록 도메인 + 폼 있으면 활성화', () => {
    expect(
      shouldActivateBaedaeji({
        host: 'www.malltail.com',
        doc: docFrom(formHtml),
        registeredDomains: ['malltail.com'],
      }),
    ).toBe(true);
  });

  it('미등록 도메인이면 폼이 있어도 비활성 (오탐 0)', () => {
    expect(
      shouldActivateBaedaeji({
        host: 'random-korean-site.kr',
        doc: docFrom(formHtml),
        registeredDomains: ['malltail.com'],
      }),
    ).toBe(false);
  });

  it('등록 도메인이지만 폼이 없으면 비활성 (안내 페이지 등)', () => {
    expect(
      shouldActivateBaedaeji({
        host: 'malltail.com',
        doc: docFrom('<h1>이용안내</h1><input />'),
        registeredDomains: ['malltail.com'],
      }),
    ).toBe(false);
  });
});

describe('looksLikeBaedaejiForm (하이브리드 등록 제안 신호)', () => {
  it('배대지 키워드 + 폼 필드 3개 이상이면 true', () => {
    expect(looksLikeBaedaejiForm(docFrom(formHtml), 'https://x.kr/order')).toBe(true);
  });

  it('키워드가 없으면 false (무관한 한국 쇼핑몰 폼)', () => {
    const html = `<h1>회원가입</h1><form><input /><input /><input /></form>`;
    expect(looksLikeBaedaejiForm(docFrom(html), 'https://x.kr/join')).toBe(false);
  });

  it('키워드는 있으나 폼 필드가 부족하면 false', () => {
    const html = `<h1>배송대행 이용안내</h1><p>배대지 서비스 소개</p><input />`;
    expect(looksLikeBaedaejiForm(docFrom(html), 'https://x.kr/guide')).toBe(false);
  });
});
