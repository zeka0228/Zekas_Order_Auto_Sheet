import { describe, expect, it } from 'vitest';
import { looksLikeBaedaejiForm } from './baedaeji-gate';

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

describe('looksLikeBaedaejiForm', () => {
  it('배대지 키워드 + 폼 필드 3개 이상이면 true', () => {
    expect(looksLikeBaedaejiForm(docFrom(formHtml), 'https://x.kr/order')).toBe(true);
  });

  it('키워드가 없으면 false (무관한 한국 쇼핑몰 폼)', () => {
    const html = `
      <h1>회원가입</h1>
      <form><input /><input /><input /></form>`;
    expect(looksLikeBaedaejiForm(docFrom(html), 'https://x.kr/join')).toBe(false);
  });

  it('키워드는 있으나 폼 필드가 부족하면 false (안내/소개 페이지)', () => {
    const html = `<h1>배송대행 이용안내</h1><p>배대지 서비스 소개</p><input />`;
    expect(looksLikeBaedaejiForm(docFrom(html), 'https://x.kr/guide')).toBe(false);
  });

  it('버튼·체크박스류만 있는 폼은 필드 수에 안 셈', () => {
    const html = `
      <h1>배송대행 신청</h1>
      <form>
        <input type="checkbox" /><input type="submit" /><input type="button" />
      </form>`;
    expect(looksLikeBaedaejiForm(docFrom(html), 'https://x.kr/order')).toBe(false);
  });
});
