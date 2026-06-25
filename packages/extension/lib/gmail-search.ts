/**
 * Gmail 검색 쿼리·URL 생성과 검색 결과 행 선택 (§1.9 후속 — 자동 백필 탭).
 *
 * background가 결제 직후 백그라운드 Gmail 탭을 `#search/<쿼리>`로 열고, content script가 그
 * 검색 결과에서 주문확인 메일 행을 골라 클릭한다(메일을 열면 기존 `.a3s` 백필이 발동).
 *
 * Gmail 리스트/검색 DOM은 난독화·불안정이라 gmail-scrape.ts가 의도적으로 피해온 영역이다.
 * 여기서는 자동화를 위해 불가피하게 행을 읽되, (1) 다중 폴백 선택자 (2) 못 찾으면 빈 결과
 * 반환(throw 금지) 로 위험을 한정한다. **정확한 후보 매칭은 메일을 연 뒤 backfillFromOpenEmail
 * 에 위임**하므로 행 선택은 "판매처 + 최신"만 맞으면 충분하다.
 *
 * DOM·chrome API에 직접 의존하지 않는 순수 함수만 둔다(행 `.click()`·렌더 폴링은 content
 * script가 담당) — happy-dom으로 단위 테스트 가능.
 */
import { domainMatches, mainDomainLabel } from './order-email';
import type { BackfillCandidate } from './order-email';

/** Gmail 표준 계정 인덱스(멀티계정 한계: u/0 고정 — 알려진 한계로 문서화). */
const ACCOUNT_INDEX = 0;

/**
 * 후보 도메인으로 Gmail 검색 쿼리를 만든다: `from:<핵심라벨> newer_than:1d`.
 * 핵심 라벨을 못 뽑으면(빈 문자열) '' 반환 — 호출측은 검색을 건너뛴다.
 * `from:` 은 발신 헤더를 매칭하므로 shop.asobistore.jp 주문이라도 asobistore.jp 발신 메일을 잡는다.
 */
export function buildGmailSearchQuery(domain: string): string {
  const label = mainDomainLabel(domain);
  if (!label) return '';
  return `from:${label} newer_than:1d`;
}

/** 검색 쿼리를 백그라운드로 열 Gmail standalone 검색 URL로 변환(u/0 고정). */
export function buildGmailSearchUrl(query: string): string {
  return `https://mail.google.com/mail/u/${ACCOUNT_INDEX}/#search/${encodeURIComponent(query)}`;
}

/** 검색 결과 행 한 줄의 최소 요약(클릭 대상 엘리먼트 + 느슨한 매칭 단서). */
export interface SearchResultRow {
  /** 클릭해 메일을 열 엘리먼트. */
  el: Element;
  /** 발신 주소/도메인(있으면). 행 선택의 도메인 매칭에 쓴다. */
  from?: string;
  /** 제목(있으면). 디버깅·향후 매칭 보강용. */
  subject?: string;
}

// 행 컨테이너 폴백 선택자 — 위에서부터 먼저 매칭되는 셋을 쓴다(중복 카운트 회피).
const ROW_SELECTORS = ['tr.zA', 'tr[data-legacy-thread-id]', '[role="row"][jsaction]'];
// 행 안의 발신/제목 — 난독화 클래스 대신 속성·안정 클래스를 우선.
const FROM_SELECTORS = ['span[email]', '[email]'];
const SUBJECT_SELECTORS = ['.bog', '.y6 span', '.y6'];

function firstText(el: Element, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const node = el.querySelector(sel);
    const txt = node?.textContent?.trim();
    if (txt) return txt;
  }
  return undefined;
}

function firstEmail(el: Element, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const node = el.querySelector(sel);
    const addr = node?.getAttribute('email')?.trim();
    if (addr) return addr;
  }
  return undefined;
}

/**
 * 검색 결과 행들을 화면 순서대로 추출한다(최신이 위). 폴백 선택자로 첫 비어있지 않은 셋을 쓰고,
 * 아무 것도 못 찾으면 빈 배열(=아직 렌더 전이거나 결과 없음 또는 DOM 변경). 절대 throw하지 않는다.
 */
export function findSearchResultRows(root: ParentNode = document): SearchResultRow[] {
  for (const rowSel of ROW_SELECTORS) {
    const els = Array.from(root.querySelectorAll(rowSel));
    if (els.length === 0) continue;
    return els.map((el) => ({
      el,
      from: firstEmail(el, FROM_SELECTORS),
      subject: firstText(el, SUBJECT_SELECTORS),
    }));
  }
  return [];
}

/**
 * 열 행 하나를 고른다: 후보 도메인과 발신이 일치하는 가장 위(최신) 행 우선, 없으면 최상단 행.
 * (정확한 후보 매칭은 메일을 연 뒤 backfillFromOpenEmail이 하므로 여기선 느슨해도 안전.)
 * 행이 없으면 null.
 */
export function pickRowToOpen(
  rows: SearchResultRow[],
  candidates: BackfillCandidate[],
): Element | null {
  const first = rows[0];
  if (!first) return null;
  const matched = rows.find(
    (r) => r.from && candidates.some((c) => domainMatches(c.domain, r.from as string)),
  );
  return (matched ?? first).el;
}
