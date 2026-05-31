import { describe, expect, it } from 'vitest';
import { extractFullBodyText, findFullMessageUrl, scrapeOpenEmail } from './gmail-scrape';

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

describe('findFullMessageUrl', () => {
  it('잘린 메일의 "전체 메일 보기"(view=lg) 링크 URL 반환', () => {
    const html = `<div class="a3s">앞부분만 보이고 잘린 본문…
      <a href="https://mail.google.com/mail/u/0/?ui=2&ik=abc&view=lg&permmsgid=msg-f:123&th=t">전체 메일 보기</a>
    </div>`;
    const url = findFullMessageUrl(gmailDoc(html));
    expect(url).toContain('view=lg');
    expect(url).toContain('permmsgid=msg-f:123');
  });

  it('view=lg가 마지막 파라미터여도 매칭', () => {
    const html = `<a href="https://mail.google.com/mail/u/1/?th=t&view=lg">전체 메일 보기</a>`;
    expect(findFullMessageUrl(gmailDoc(html))).toContain('view=lg');
  });

  it('잘린 링크 없으면 null (짧은 메일)', () => {
    expect(findFullMessageUrl(gmailDoc('<div class="a3s">짧은 본문</div>'))).toBeNull();
  });

  it('mail.google.com 외 호스트의 view=lg 링크는 무시 (임의 출처 fetch 방지)', () => {
    const html = `<a href="https://evil.example.com/?view=lg">전체 메일 보기</a>`;
    expect(findFullMessageUrl(gmailDoc(html))).toBeNull();
  });
});

describe('extractFullBodyText', () => {
  it('전체 뷰의 .a3s 본문 텍스트 추출', () => {
    const doc = gmailDoc('<body><div class="a3s">【주문 번호】FULL-123 잘리지 않은 전체 본문</div></body>');
    expect(extractFullBodyText(doc)).toContain('FULL-123');
  });

  it('.a3s 없으면 문서 전체 텍스트로 폴백', () => {
    const doc = gmailDoc('<body><div>주문번호 BODY-9 어딘가에</div></body>');
    expect(extractFullBodyText(doc)).toContain('BODY-9');
  });
});
