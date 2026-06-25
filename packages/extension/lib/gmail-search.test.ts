import { describe, expect, it } from 'vitest';
import {
  buildGmailSearchQuery,
  buildGmailSearchUrl,
  findSearchResultRows,
  pickRowToOpen,
} from './gmail-search';
import type { BackfillCandidate } from './order-email';

function gmailDoc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const candidate = (overrides: Partial<BackfillCandidate> = {}): BackfillCandidate => ({
  id: 'o1',
  domain: 'shop.asobistore.jp',
  capturedAt: 1000,
  ...overrides,
});

describe('buildGmailSearchQuery', () => {
  it('서브도메인 host에서 핵심 라벨로 from: 쿼리 생성', () => {
    expect(buildGmailSearchQuery('shop.asobistore.jp')).toBe('from:asobistore newer_than:1d');
  });

  it('co.jp 같은 2차 도메인도 핵심 라벨만', () => {
    expect(buildGmailSearchQuery('asobistore.co.jp')).toBe('from:asobistore newer_than:1d');
  });

  it('www는 제거', () => {
    expect(buildGmailSearchQuery('www.amazon.com')).toBe('from:amazon newer_than:1d');
  });

  it('라벨을 못 뽑으면 빈 문자열(호출측 스킵)', () => {
    expect(buildGmailSearchQuery('')).toBe('');
  });
});

describe('buildGmailSearchUrl', () => {
  it('u/0 standalone 검색 URL로 인코딩', () => {
    expect(buildGmailSearchUrl('from:asobistore newer_than:1d')).toBe(
      'https://mail.google.com/mail/u/0/#search/from%3Aasobistore%20newer_than%3A1d',
    );
  });
});

const RESULTS = `
<div role="main">
  <table><tbody>
    <tr class="zA zE" data-legacy-thread-id="t1">
      <td><span class="yX"><span email="noreply@mail.asobistore.jp" name="스토어"></span></span></td>
      <td><span class="bog">【테스트 스토어】ご注文ありがとうございます</span></td>
    </tr>
    <tr class="zA yO" data-legacy-thread-id="t2">
      <td><span email="news@othershop.com"></span></td>
      <td><span class="bog">뉴스레터</span></td>
    </tr>
  </tbody></table>
</div>`;

describe('findSearchResultRows', () => {
  it('검색 결과 행에서 발신/제목 추출(화면 순서)', () => {
    const rows = findSearchResultRows(gmailDoc(RESULTS));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.from).toBe('noreply@mail.asobistore.jp');
    expect(rows[0]?.subject).toContain('ご注文');
    expect(rows[1]?.from).toBe('news@othershop.com');
  });

  it('결과 없음(리스트 미렌더)이면 빈 배열', () => {
    expect(findSearchResultRows(gmailDoc('<div role="main"></div>'))).toEqual([]);
  });

  it('data-legacy-thread-id 폴백 선택자로도 행을 잡는다', () => {
    const html = `<div><tr data-legacy-thread-id="x"><span email="a@b.com"></span></tr></div>`;
    const rows = findSearchResultRows(gmailDoc(html));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.from).toBe('a@b.com');
  });
});

describe('pickRowToOpen', () => {
  it('후보 도메인과 일치하는 발신 행을 우선 선택', () => {
    const rows = findSearchResultRows(gmailDoc(RESULTS));
    const picked = pickRowToOpen(rows, [candidate()]);
    expect(picked).toBe(rows[0]?.el); // asobistore 발신 행
  });

  it('일치 발신이 없으면 최상단(최신) 행', () => {
    const rows = findSearchResultRows(gmailDoc(RESULTS));
    const picked = pickRowToOpen(rows, [candidate({ domain: 'nowhere.example' })]);
    expect(picked).toBe(rows[0]?.el);
  });

  it('행이 없으면 null', () => {
    expect(pickRowToOpen([], [candidate()])).toBeNull();
  });
});
