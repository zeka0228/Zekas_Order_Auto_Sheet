import { describe, expect, it } from 'vitest';
import { scrapeOpenEmail } from './gmail-scrape';

function gmailDoc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

// 실제 asobistore 주문확인 메일과 같은 구조 (PII는 가짜). 라벨이 【】로 감싸짐.
const OPEN_EMAIL = `
<div role="main">
  <h2 class="hP">【테스트 스토어】상품 발송 안내：(FAKE-ORDER-001)</h2>
  <div class="gs"><div class="gE iv gt"><h3 class="iw gFxsud">
    <span email="noreply@mail.asobistore.jp" name="테스트스토어" class="gD"><span>테스트스토어</span></span>
    <span class="go"><span aria-hidden="true">&lt;</span>noreply@mail.asobistore.jp<span aria-hidden="true">&gt;</span></span>
  </h3></div></div>
  <div class="ii gt"><div class="a3s aiL">
    <font>【주문자】홍길동님 【주문 번호】FAKE-ORDER-001 【주문 일시】2026/05/30</font>
    <font>상품 금액 합계(부가세 포함)：3,900엔</font>
  </div></div>
</div>`;

describe('scrapeOpenEmail', () => {
  it('열린 메일에서 발신/제목/본문 추출', () => {
    const email = scrapeOpenEmail(gmailDoc(OPEN_EMAIL));
    expect(email).not.toBeNull();
    expect(email?.from).toBe('noreply@mail.asobistore.jp');
    expect(email?.subject).toContain('상품 발송 안내');
    expect(email?.bodyText).toContain('FAKE-ORDER-001');
  });

  it('열린 메일(.a3s)이 없으면 null (받은편지함 목록 상태)', () => {
    expect(scrapeOpenEmail(gmailDoc('<div role="main">받은편지함 목록</div>'))).toBeNull();
  });

  it('발신 email 속성이 없으면 null', () => {
    const noFrom = `<div><h2 class="hP">제목</h2><div class="a3s">본문</div></div>`;
    expect(scrapeOpenEmail(gmailDoc(noFrom))).toBeNull();
  });
});
