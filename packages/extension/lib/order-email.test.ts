import { describe, expect, it } from 'vitest';
import {
  looksLikeOrderEmail,
  extractOrderNumber,
  mainDomainLabel,
  domainMatches,
  matchEmailToOrder,
  findBackfills,
  type EmailSummary,
  type BackfillCandidate,
} from './order-email';

describe('looksLikeOrderEmail', () => {
  it.each([
    'ご注文ありがとうございます（注文確認）',
    'Your order confirmation',
    'Order #12345 confirmed',
    '[ASOBISTORE] 注文番号のお知らせ',
    '주문이 완료되었습니다',
    '订单确认',
    '訂單確認通知',
  ])('주문확인 제목 통과: %s', (s) => {
    expect(looksLikeOrderEmail(s)).toBe(true);
  });

  it.each([
    '여름 세일 최대 70%',
    'Weekly newsletter',
    '배송이 시작되었습니다 안내', // 배송추적은 주문확인 아님
    'ポイントが付与されました',
  ])('주문확인 아닌 제목 거름: %s', (s) => {
    expect(looksLikeOrderEmail(s)).toBe(false);
  });
});

describe('extractOrderNumber', () => {
  it.each([
    ['注文番号: A10232025', 'A10232025'],
    ['ご注文番号 ORD-99887', 'ORD-99887'],
    ['Order number: 12345678', '12345678'],
    ['Your Order #ABC-2024-1', 'ABC-2024-1'],
    ['주문번호 : KR20240519', 'KR20240519'],
    ['订单编号：CN8899001', 'CN8899001'],
    ['訂單號碼: TW55667788', 'TW55667788'],
    ['Confirmation number: CONF1234', 'CONF1234'],
  ])('추출: %s → %s', (text, expected) => {
    expect(extractOrderNumber(text)).toBe(expected);
  });

  it('패턴 없으면 undefined', () => {
    expect(extractOrderNumber('감사합니다. 곧 발송됩니다.')).toBeUndefined();
  });

  it('너무 짧은 값(3자 이하)은 무시', () => {
    expect(extractOrderNumber('order no: 12')).toBeUndefined();
  });
});

describe('mainDomainLabel', () => {
  it.each([
    ['shop.asobistore.jp', 'asobistore'],
    ['asobistore.jp', 'asobistore'],
    ['asobistore.co.jp', 'asobistore'],
    ['shop.asobistore.co.jp', 'asobistore'],
    ['www.amazon.com', 'amazon'],
    ['store.example.co.kr', 'example'],
    ['localhost', 'localhost'],
  ])('%s → %s', (host, expected) => {
    expect(mainDomainLabel(host)).toBe(expected);
  });
});

describe('domainMatches', () => {
  it('서브도메인·발신주소 달라도 핵심 라벨 같으면 매칭', () => {
    expect(domainMatches('shop.asobistore.jp', 'noreply@asobistore.jp')).toBe(true);
    expect(domainMatches('shop.asobistore.jp', 'info@asobistore.co.jp')).toBe(true);
    expect(domainMatches('www.amazon.com', 'ship-confirm@amazon.com')).toBe(true);
  });

  it('핵심 라벨 다르면 불일치', () => {
    expect(domainMatches('shop.asobistore.jp', 'noreply@rakuten.co.jp')).toBe(false);
    expect(domainMatches('shop.asobistore.jp', 'newsletter@asobi-store.jp')).toBe(false);
  });
});

describe('matchEmailToOrder', () => {
  const order: BackfillCandidate = {
    id: 'o1',
    domain: 'shop.asobistore.jp',
    capturedAt: 1_000_000,
  };
  const base: EmailSummary = {
    from: 'noreply@asobistore.jp',
    subject: '注文確認',
    receivedAt: 1_000_000 + 60_000, // 1분 뒤
    bodyText: '注文番号: A123456',
  };

  it('도메인·제목·시간창 모두 맞으면 true', () => {
    expect(matchEmailToOrder(order, base)).toBe(true);
  });

  it('다른 도메인이면 false', () => {
    expect(matchEmailToOrder(order, { ...base, from: 'x@rakuten.co.jp' })).toBe(false);
  });

  it('주문확인 제목 아니면 false', () => {
    expect(matchEmailToOrder(order, { ...base, subject: '여름 세일' })).toBe(false);
  });

  it('시간창(기본 30분) 벗어나면 false', () => {
    expect(matchEmailToOrder(order, { ...base, receivedAt: 1_000_000 + 31 * 60_000 })).toBe(false);
  });

  it('결제 전(시계오차 5분 초과 이전)이면 false', () => {
    expect(matchEmailToOrder(order, { ...base, receivedAt: 1_000_000 - 6 * 60_000 })).toBe(false);
  });
});

describe('findBackfills', () => {
  const o1: BackfillCandidate = { id: 'o1', domain: 'shop.asobistore.jp', capturedAt: 1_000_000 };
  const o2: BackfillCandidate = { id: 'o2', domain: 'www.amazon.co.jp', capturedAt: 2_000_000 };
  const orders = [o1, o2];

  it('각 주문에 매칭되는 주문확인 메일의 번호를 백필', () => {
    const emails: EmailSummary[] = [
      {
        from: 'noreply@asobistore.jp',
        subject: 'ご注文ありがとうございます',
        receivedAt: 1_000_000 + 90_000,
        bodyText: '注文番号: A10232025',
      },
      {
        from: 'auto-confirm@amazon.co.jp',
        subject: 'Amazon.co.jp ご注文の確認',
        receivedAt: 2_000_000 + 120_000,
        bodyText: '注文番号 503-1234567-8901234',
      },
      // 노이즈: 도메인은 맞지만 뉴스레터
      {
        from: 'news@asobistore.jp',
        subject: '週末セール',
        receivedAt: 1_000_000 + 30_000,
        bodyText: '注文番号: SHOULD-NOT-MATCH',
      },
    ];
    const result = findBackfills(orders, emails);
    expect(result).toContainEqual({ orderId: 'o1', orderNumber: 'A10232025' });
    expect(result).toContainEqual({ orderId: 'o2', orderNumber: '503-1234567-8901234' });
  });

  it('매칭되지만 번호 추출 실패하면 그 주문은 백필 없음', () => {
    const emails: EmailSummary[] = [
      {
        from: 'noreply@asobistore.jp',
        subject: '注文確認',
        receivedAt: 1_000_000 + 60_000,
        bodyText: '곧 발송 예정입니다.', // 번호 없음
      },
    ];
    expect(findBackfills([o1], emails)).toEqual([]);
  });

  it('가장 이른 매칭 메일부터 번호를 시도한다', () => {
    const emails: EmailSummary[] = [
      {
        from: 'noreply@asobistore.jp',
        subject: '注文確認(再送)',
        receivedAt: 1_000_000 + 300_000,
        bodyText: '注文番号: LATER999',
      },
      {
        from: 'noreply@asobistore.jp',
        subject: '注文確認',
        receivedAt: 1_000_000 + 60_000,
        bodyText: '注文番号: EARLY111',
      },
    ];
    expect(findBackfills([o1], emails)).toEqual([
      { orderId: 'o1', orderNumber: 'EARLY111' },
    ]);
  });
});
