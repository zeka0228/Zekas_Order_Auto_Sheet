/**
 * 장바구니 (및 결제 진행) 페이지의 마스킹 HTML 누적 — 완료 페이지에서 AI 호출 시 추가 컨텍스트로 활용.
 *
 * 설계 (사용자 아이디어, 2026-05-26 결정):
 *   - 첫 AI 호출은 결제 완료 시점이 이상적이지만, 완료 페이지엔 가격·상품명이 없을 수 있음.
 *   - 그래서 장바구니/결제 진행 페이지 진입 시 마스킹 HTML을 도메인당 1슬롯에 저장.
 *   - 같은 페이지에서 form submit이 일어나면 최신 DOM(수량 조정·쿠폰 적용 후)으로 덮어쓰기.
 *   - 완료 페이지에서 consume → Worker에 extra_context_html로 함께 전달 → AI가 두 컨텍스트로
 *     상품명·가격·payButton·주문번호 셀렉터를 일괄 추출.
 *
 * 저장소: chrome.storage.local (navigation 가로질러 살아남음).
 * Race condition: content script가 페이지 이동 직전 직접 storage.set하면 promise resolve 못함 →
 *   background로 sendMessage(fire-and-forget) → background가 storage 저장. 메시지 큐에 들어가면
 *   페이지 navigate되어도 저장은 성공.
 */

const SNAP_PREFIX = 'cart_html_snapshot:';
/** TTL — 사용자가 장바구니 진입 후 24h 내 결제 안 하면 stale로 폐기. */
const TTL_MS = 24 * 60 * 60_000;

export interface CartHtmlSnapshot {
  domain: string;
  url: string;
  maskedHtml: string;
  capturedAt: number;
}

type Area = chrome.storage.StorageArea;

const snapKey = (domain: string): string => `${SNAP_PREFIX}${domain}`;

/**
 * 도메인당 한 슬롯에 저장. 다시 저장하면 덮어쓴다 — 최신 캡처가 진실.
 * (장바구니 진입 직후 캡처 → submit 직전 캡처가 덮어쓰는 흐름.)
 */
export async function saveCartSnapshot(
  snap: CartHtmlSnapshot,
  area: Area = chrome.storage.local,
): Promise<void> {
  await area.set({ [snapKey(snap.domain)]: snap });
}

/**
 * 완료 페이지에서 스냅샷을 읽고 즉시 삭제(consume-once).
 * TTL 초과 시 null. 삭제는 항상 수행 — 한 번 소비하면 사라진다.
 */
export async function consumeCartSnapshot(
  domain: string,
  now: number = Date.now(),
  area: Area = chrome.storage.local,
): Promise<CartHtmlSnapshot | null> {
  const key = snapKey(domain);
  const got = await area.get(key);
  const snap = (got as Record<string, CartHtmlSnapshot | undefined>)[key];
  await area.remove(key);
  if (!snap) return null;
  if (now - snap.capturedAt > TTL_MS) return null;
  return snap;
}

/** 디버깅·테스트용 — 소비 없이 조회. */
export async function peekCartSnapshot(
  domain: string,
  now: number = Date.now(),
  area: Area = chrome.storage.local,
): Promise<CartHtmlSnapshot | null> {
  const key = snapKey(domain);
  const got = await area.get(key);
  const snap = (got as Record<string, CartHtmlSnapshot | undefined>)[key];
  if (!snap) return null;
  if (now - snap.capturedAt > TTL_MS) return null;
  return snap;
}
