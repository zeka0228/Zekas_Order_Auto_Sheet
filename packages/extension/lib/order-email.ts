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
  /** 캡처된 가격 — 동일 도메인 다중 주문 구별용(금액 대조). */
  price?: { amount: number; currency: string };
  /** 캡처된 상품명 — 금액으로도 안 갈리면 본문 등장 여부로 구별. */
  productName?: string;
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
// 라벨과 값 사이의 구분자 — 공백·콜론(반각/전각)·#·닫는 괄호류. asobistore는 【주문 번호】값
// 처럼 값을 】로 닫으므로 】·]·)·＞도 허용. 값 자체는 영숫자라 이 클래스가 번호를 먹지 않음.
const SEP = '[\\s:：#\\]】)）＞>]*';
const VAL = '([A-Za-z0-9][A-Za-z0-9-]{3,})';
const ORDER_NUMBER_PATTERNS: RegExp[] = [
  new RegExp(`(?:ご)?注文番号${SEP}${VAL}`),
  new RegExp(`order\\s*(?:number|no\\.?|id|#)${SEP}${VAL}`, 'i'),
  new RegExp(`주문\\s*번호${SEP}${VAL}`),
  new RegExp(`(?:订单|訂單)\\s*[编編号號码碼]*${SEP}${VAL}`),
  new RegExp(`(?:confirmation|receipt)\\s*(?:number|no\\.?|#)${SEP}${VAL}`, 'i'),
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

/** 본문에서 통화에 인접한 금액들을 추출(천단위 콤마 제거). 동일 도메인 다중 주문 구별용. */
export function extractAmounts(text: string): number[] {
  // 통화기호 + 숫자, 또는 숫자 + 통화 접미사(원/円/元/엔 등). 통화 인접만 — 날짜·우편번호 배제.
  const re = /(?:[¥$€₩£]\s*)([\d][\d,]*(?:\.\d+)?)|([\d][\d,]*(?:\.\d+)?)\s*(?:원|엔|円|圓|圆|元)/g;
  const out: number[] = [];
  for (const m of text.matchAll(re)) {
    const raw = m[1] ?? m[2];
    if (!raw) continue;
    const n = Number(raw.replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * 열람 시 백필 (§1.9): 사용자가 연 메일 한 건에서 번호를 뽑아 후보 주문에 매칭한다.
 *
 * 매칭 캐스케이드 (발신 도메인 일치 후보 안에서, 복수면 다음 단계로):
 *   1) 도메인 일치 후보로 시작 (없으면 null).
 *   2) 복수면 **금액 대조** — 본문 금액 목록에 후보 price.amount가 든 것만. (1건이면 확정)
 *   3) 그래도 복수면 **상품명 대조** — 후보 productName이 본문에 등장하는 것만.
 *   4) 끝까지 복수면 **가장 최근**(capturedAt).
 * 각 단계는 결과가 0이면 그 단계를 건너뛴다(과도하게 비우지 않음).
 *
 * findBackfills와 달리 제목 화이트리스트·시간창을 쓰지 않는다 — 사용자가 직접 그 메일을 연
 * 시점이라 "주문확인인가"는 본문에서 번호가 뽑히는지로 갈음하고, 열람은 결제 후 한참 뒤일 수
 * 있어 시간창이 의미 없기 때문. 후보는 호출측에서 orderNumber 빈 것만 넘긴다.
 */
export function backfillFromOpenEmail(
  orders: BackfillCandidate[],
  email: EmailSummary,
): Backfill | null {
  const text = `${email.subject}\n${email.bodyText}`;
  const orderNumber = extractOrderNumber(text);
  if (!orderNumber) return null;

  let set = orders.filter((o) => domainMatches(o.domain, email.from));
  if (set.length === 0) return null;

  if (set.length > 1) {
    const amounts = extractAmounts(text);
    const byAmount = set.filter((o) => o.price && amounts.includes(o.price.amount));
    if (byAmount.length >= 1) set = byAmount;
  }
  if (set.length > 1) {
    const byProduct = set.filter((o) => o.productName && text.includes(o.productName));
    if (byProduct.length >= 1) set = byProduct;
  }
  const target = [...set].sort((a, b) => b.capturedAt - a.capturedAt)[0];
  return target ? { orderId: target.id, orderNumber } : null;
}
