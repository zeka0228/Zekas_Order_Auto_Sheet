import { describe, expect, it, vi } from 'vitest';
import { backfillOnOpenEmail } from './gmail-backfill';
import type { BackfillCandidate } from './order-email';

const VIEW_LG = 'https://mail.google.com/mail/u/0/?ui=2&view=lg&permmsgid=msg-f:1&th=t';

/** 열린 Gmail 메일 DOM을 만든다 (scrapeOpenEmail이 읽는 .a3s / h3 span[email] / h2.hP 구조). */
function emailDoc(opts: {
  from: string;
  subject: string;
  body: string;
  clip?: boolean;
}): Document {
  const clipLink = opts.clip ? `<a href="${VIEW_LG}">전체 메일 보기</a>` : '';
  return new DOMParser().parseFromString(
    `<div role="main">
       <h2 class="hP">${opts.subject}</h2>
       <h3><span email="${opts.from}" class="gD"><span>shop</span></span></h3>
       <div class="ii gt"><div class="a3s aiL">${opts.body}${clipLink}</div></div>
     </div>`,
    'text/html',
  );
}

const asobi: BackfillCandidate = {
  id: 'o1',
  domain: 'shop.asobistore.jp',
  capturedAt: 1000,
  price: { amount: 3900, currency: 'JPY' },
  productName: '테스트상품',
};

describe('backfillOnOpenEmail — 잘린 본문 펼치기 (v1.7.1)', () => {
  it('부분 본문에 번호가 있으면 fetch 없이 즉시 백필', async () => {
    const doc = emailDoc({
      from: 'noreply@mail.asobistore.jp',
      subject: '【테스트 스토어】상품 발송 안내',
      body: '【주문 번호】FAST-1234 감사합니다',
    });
    const fetchFullText = vi.fn(async () => '');
    const hit = await backfillOnOpenEmail({ doc, candidates: [asobi], fetchFullText });
    expect(hit).toEqual({ orderId: 'o1', orderNumber: 'FAST-1234' });
    expect(fetchFullText).not.toHaveBeenCalled();
  });

  it('부분 본문에 번호가 없고 클립됐으면 전체 본문 fetch 후 백필', async () => {
    const doc = emailDoc({
      from: 'noreply@mail.asobistore.jp',
      subject: '【테스트 스토어】주문 확인',
      body: '주문해 주셔서 감사합니다. 이하 내용은…', // 번호는 클립 뒤에
      clip: true,
    });
    const fetchFullText = vi.fn(async () => '【주문 번호】CLIP-9876 상품 금액 3,900엔');
    const hit = await backfillOnOpenEmail({ doc, candidates: [asobi], fetchFullText });
    expect(fetchFullText).toHaveBeenCalledTimes(1);
    expect(fetchFullText).toHaveBeenCalledWith(VIEW_LG);
    expect(hit).toEqual({ orderId: 'o1', orderNumber: 'CLIP-9876' });
  });

  it('번호 없음 + 클립 링크 없음(짧은 메일)이면 fetch 없이 null', async () => {
    const doc = emailDoc({
      from: 'noreply@mail.asobistore.jp',
      subject: '주문 확인',
      body: '번호가 본문에 없는 짧은 메일',
    });
    const fetchFullText = vi.fn(async () => '【주문 번호】X-1');
    const hit = await backfillOnOpenEmail({ doc, candidates: [asobi], fetchFullText });
    expect(hit).toBeNull();
    expect(fetchFullText).not.toHaveBeenCalled();
  });

  it('도메인 일치 후보가 없으면 클립됐어도 fetch하지 않음(헛수고 회피)', async () => {
    const doc = emailDoc({
      from: 'noreply@other-shop.com',
      subject: '주문 확인',
      body: '번호 없는 잘린 본문…',
      clip: true,
    });
    const fetchFullText = vi.fn(async () => '【주문 번호】CLIP-9876');
    const hit = await backfillOnOpenEmail({ doc, candidates: [asobi], fetchFullText });
    expect(hit).toBeNull();
    expect(fetchFullText).not.toHaveBeenCalled();
  });

  it('fetch가 빈 문자열(실패)이면 null — 비퇴보', async () => {
    const doc = emailDoc({
      from: 'noreply@mail.asobistore.jp',
      subject: '주문 확인',
      body: '번호 없는 잘린 본문…',
      clip: true,
    });
    const fetchFullText = vi.fn(async () => '');
    const hit = await backfillOnOpenEmail({ doc, candidates: [asobi], fetchFullText });
    expect(hit).toBeNull();
    expect(fetchFullText).toHaveBeenCalledTimes(1);
  });

  it('전체 본문을 받아도 번호가 없으면 null', async () => {
    const doc = emailDoc({
      from: 'noreply@mail.asobistore.jp',
      subject: '주문 확인',
      body: '번호 없는 잘린 본문…',
      clip: true,
    });
    const fetchFullText = vi.fn(async () => '전체 본문이지만 주문번호 라벨이 없음');
    const hit = await backfillOnOpenEmail({ doc, candidates: [asobi], fetchFullText });
    expect(hit).toBeNull();
  });

  it('후보가 없으면 스크랩·fetch 없이 null', async () => {
    const doc = emailDoc({ from: 'a@b.com', subject: 's', body: '【주문 번호】Z-1', clip: true });
    const fetchFullText = vi.fn(async () => '');
    const hit = await backfillOnOpenEmail({ doc, candidates: [], fetchFullText });
    expect(hit).toBeNull();
    expect(fetchFullText).not.toHaveBeenCalled();
  });

  it('열린 메일(.a3s)이 아니면 null (리스트 화면)', async () => {
    const doc = new DOMParser().parseFromString('<div role="main">받은편지함 목록</div>', 'text/html');
    const fetchFullText = vi.fn(async () => '');
    const hit = await backfillOnOpenEmail({ doc, candidates: [asobi], fetchFullText });
    expect(hit).toBeNull();
    expect(fetchFullText).not.toHaveBeenCalled();
  });

  it('동일 도메인 다중 후보 — 전체 본문 금액 대조로 올바른 주문에 백필', async () => {
    const other: BackfillCandidate = {
      id: 'o2',
      domain: 'shop.asobistore.jp',
      capturedAt: 2000,
      price: { amount: 12000, currency: 'JPY' },
      productName: '다른상품',
    };
    const doc = emailDoc({
      from: 'noreply@mail.asobistore.jp',
      subject: '주문 확인',
      body: '잘린 본문…',
      clip: true,
    });
    // 전체 본문 금액 3,900엔 → o1(3900)로 갈려야 함 (o2는 12000).
    const fetchFullText = vi.fn(async () => '【주문 번호】MULTI-1 합계 3,900엔');
    const hit = await backfillOnOpenEmail({ doc, candidates: [asobi, other], fetchFullText });
    expect(hit).toEqual({ orderId: 'o1', orderNumber: 'MULTI-1' });
  });
});
