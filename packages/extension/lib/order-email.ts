/**
 * 주문확인 이메일 → candidate PendingOrder의 orderNumber 백필을 위한 순수 매칭·파싱 로직.
 *
 * 설계 진화 로그 §1.9: 완료 페이지 캡처를 폐기하고 orderNumber·결제성공은 주문확인 이메일에서
 * 가져온다. 매칭은 "최신 메일" 단독이 아니라 **발신 도메인 ∩ 시간창 ∩ 제목 화이트리스트**로
 * 좁힌다(여러 주문·뉴스레터 오매칭 방지). 파싱은 regex 우선(여기), 실패 시 AI 폴백(별도).
 *
 * 이 모듈은 Gmail DOM·chrome API에 의존하지 않는 순수 함수만 둔다 — content script가 스크랩한
 * EmailSummary 배열과 candidate 주문 배열을 받아 백필 지시를 만든다. 그래서 단위 테스트 가능.
 */

/** content script가 Gmail에서 스크랩한 메일 한 건의 요약. */
export interface EmailSummary {
  /** 발신 주소 또는 도메인 (예: "noreply@asobistore.jp" 또는 "asobistore.jp"). */
  from: string;
  subject: string;
  /** 수신 시각 (epoch ms). */
  receivedAt: number;
  /** 본문 텍스트 (제목은 별도). 없으면 빈 문자열. */
  bodyText: string;
}

/** 백필 대상 후보 주문 (orderNumber가 아직 빈 것). */
export interface BackfillCandidate {
  id: string;
  /** 주문 캡처 시점의 쇼핑몰 hostname (예: "shop.asobistore.jp"). */
  domain: string;
  /** 결제하기 클릭 시각 (epoch ms). */
  capturedAt: number;
}

export interface Backfill {
  orderId: string;
  orderNumber: string;
}

export interface MatchOptions {
  /** capturedAt 이후 이 시간(ms) 안에 도착한 메일만 후보. 기본 30분. */
  windowMs?: number;
  /** 시계 오차 허용 — capturedAt보다 이만큼 일찍 찍힌 메일도 허용. 기본 5분. */
  skewMs?: number;
}

const DEFAULT_WINDOW_MS = 30 * 60_000;
const DEFAULT_SKEW_MS = 5 * 60_000;

/**
 * 주문확인 메일일 법한 제목인가 (사전 필터, §1.1 화이트리스트와 같은 결).
 * 뉴스레터·배송추적·프로모션을 거르고 "주문/결제 확인" 류만 통과.
 */
const SUBJECT_RE =
  /(注文|ご注文|order\s*confirm|your\s*order|order\s*(?:number|no\.?|#)|주문|구매\s*확인|purchase\s*confirm|订单|訂單|receipt)/i;

export function looksLikeOrderEmail(subject: string): boolean {
  return SUBJECT_RE.test(subject);
}

/**
 * 본문/제목에서 주문번호를 추출한다. 다국어 라벨 뒤의 영숫자열(4자 이상)을 집는다.
 * 못 찾으면 undefined. (regex 우선 — 실패 시 호출측에서 AI 폴백.)
 */
const ORDER_NUMBER_PATTERNS: RegExp[] = [
  /(?:ご)?注文番号\s*[:：#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/,
  /order\s*(?:number|no\.?|id|#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i,
  /주문\s*번호\s*[:：#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/,
  /(?:订单|訂單)\s*[编編号號码碼]*\s*[:：#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/,
  /(?:confirmation|receipt)\s*(?:number|no\.?|#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i,
];

export function extractOrderNumber(text: string): string | undefined {
  for (const re of ORDER_NUMBER_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** ".co.jp"·"co.kr"처럼 등록 도메인 바로 앞에 오는 2차 도메인 라벨들. */
const SECOND_LEVEL = new Set([
  'co', 'com', 'ne', 'or', 'go', 'ac', 'gov', 'edu', 'org', 'net',
]);

/**
 * 호스트에서 "핵심 라벨"(등록 도메인의 주 라벨)을 뽑는다. PSL 없이 쓰는 휴리스틱:
 *   shop.asobistore.jp → asobistore, asobistore.co.jp → asobistore, www.amazon.com → amazon.
 * 한계: 공개 서픽스를 완전히 알지 못하므로 드문 다단계 TLD는 빗나갈 수 있음(매칭이 보수적이라
 * 빗나가면 백필을 못 할 뿐, 잘못된 주문에 붙진 않음).
 */
export function mainDomainLabel(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (labels.length <= 1) return labels[0] ?? '';
  const sld = labels[labels.length - 2] ?? '';
  if (labels.length >= 3 && SECOND_LEVEL.has(sld)) return labels[labels.length - 3] ?? '';
  return sld;
}

/** 발신 주소/도메인에서 호스트만 추출. "a@b.com" → "b.com", "b.com" → "b.com". */
function hostOf(from: string): string {
  const at = from.lastIndexOf('@');
  const raw = (at >= 0 ? from.slice(at + 1) : from).trim().toLowerCase();
  return raw.replace(/[>\s]+$/, '');
}

/** 주문 도메인과 메일 발신 도메인의 핵심 라벨이 같은가. */
export function domainMatches(orderDomain: string, emailFrom: string): boolean {
  const a = mainDomainLabel(orderDomain);
  const b = mainDomainLabel(hostOf(emailFrom));
  return a.length > 0 && a === b;
}

function withinWindow(
  capturedAt: number,
  receivedAt: number,
  windowMs: number,
  skewMs: number,
): boolean {
  return receivedAt >= capturedAt - skewMs && receivedAt <= capturedAt + windowMs;
}

/** 한 메일이 한 주문의 주문확인 메일로 볼 수 있는가 (도메인 ∩ 제목 ∩ 시간창). */
export function matchEmailToOrder(
  order: BackfillCandidate,
  email: EmailSummary,
  opts: MatchOptions = {},
): boolean {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const skewMs = opts.skewMs ?? DEFAULT_SKEW_MS;
  return (
    looksLikeOrderEmail(email.subject) &&
    domainMatches(order.domain, email.from) &&
    withinWindow(order.capturedAt, email.receivedAt, windowMs, skewMs)
  );
}

/**
 * 후보 주문들과 스크랩한 메일들로 백필 지시를 만든다.
 * 각 주문에 대해 매칭되는 메일 중 **가장 이른**(결제 직후) 것부터 보고, 주문번호를 추출할 수
 * 있는 첫 메일을 채택. 주문번호를 못 뽑으면 그 주문은 백필 없음.
 */
export function findBackfills(
  orders: BackfillCandidate[],
  emails: EmailSummary[],
  opts: MatchOptions = {},
): Backfill[] {
  const out: Backfill[] = [];
  for (const order of orders) {
    const matched = emails
      .filter((e) => matchEmailToOrder(order, e, opts))
      .sort((a, b) => a.receivedAt - b.receivedAt);
    for (const email of matched) {
      const orderNumber = extractOrderNumber(`${email.subject}\n${email.bodyText}`);
      if (orderNumber) {
        out.push({ orderId: order.id, orderNumber });
        break;
      }
    }
  }
  return out;
}
