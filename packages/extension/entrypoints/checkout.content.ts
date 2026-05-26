import { getCachedConfig, generateConfig, reportSuccess } from '../lib/config-client';
import { sanitizeHTML } from '../lib/html-masker';
import { parseWithSelectors, hasCriticalFields } from '../lib/checkout-parser';
import {
  saveSnapshot,
  consumeSnapshot,
  mergeCapture,
  buildPendingOrder,
} from '../lib/order-snapshot';
import {
  consumeCartSnapshot,
  type CartHtmlSnapshot,
} from '../lib/cart-html-snapshot';
import { savePendingOrder } from '../lib/storage';
import { reportParseOutcome, tryHeal } from '../lib/self-healing';
import {
  looksLikeCheckoutOrCompletion,
  decidePageRole,
  isCartPage,
  hasCartPriceSignal,
} from '../lib/checkout-flow';
import { isDomesticSite } from '../lib/domestic-site-gate';
import type { SiteConfig } from '../lib/schemas';

/**
 * 결제 캡처 (설계 진화 로그 §1.5 — 결제 클릭 스냅샷 + 완료 페이지 병합).
 *
 * 흐름:
 *   1) 값싼 게이트로 결제·완료 페이지일 법한지 확인 (다국어 키워드)
 *   2) 국내 사이트 차단 게이트 (해외 직구만 처리)
 *   3) 장바구니 페이지면 마스킹 HTML 누적 (진입 시 + form submit 시) 후 종료
 *      - AI 호출 안 함. 완료 페이지에서 consume하여 extra context로 전달
 *   4) 그 외 페이지: config 확보 (캐시 → 없으면 AI 생성, cart snapshot 있으면 함께 전달)
 *   5) 역할 판정:
 *      - 완료 페이지: 파싱 → 클릭 스냅샷 소비·병합 → 저장 → 자가치유 피드백
 *      - 결제 직전 페이지: payButton 클릭에 리스너 부착 → 클릭 시 스냅샷 덮어쓰기
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle', // U5: 완료 페이지를 빨리 닫아도 잡히도록
  allFrames: true,
  async main() {
    if (!looksLikeCheckoutOrCompletion(document, location.href)) return;
    if (isDomesticSite(document, location.href)) {
      console.debug('[ZOAS] 국내 사이트로 판정 — 캡처/AI 호출 스킵:', location.hostname);
      return;
    }

    const domain = location.hostname;

    if (isCartPage(location.href)) {
      // 장바구니: 마스킹 HTML 누적 + (캐시가 있으면) 셀렉터 자가 치유 검증
      captureCartHtml(domain);
      bindCartFormSubmit(domain);
      const cached = await getCachedConfig(domain, 'shop');
      if (cached) await tryParseCartAndHeal(domain, cached);
      return;
    }

    const config = await resolveConfig(domain);
    if (!config) return;

    const fields = parseWithSelectors(document, config.selectors);
    const role = decidePageRole({
      hasOrderNumber: Boolean(fields.orderNumber),
      hasPayButton: matches(config.selectors.payButton),
    });

    if (role === 'completion') {
      await captureCompletion(domain, config, fields);
    } else if (role === 'prepay') {
      bindPayClick(domain, config);
    }
  },
});

/**
 * 캐시된 config가 있으면 사용, 없으면 마스킹 HTML로 AI 생성.
 * cart snapshot이 살아있으면 함께 extra context로 전달 → AI가 두 페이지로 셀렉터 학습.
 */
async function resolveConfig(domain: string): Promise<SiteConfig | null> {
  const cached = await getCachedConfig(domain, 'shop');
  if (cached) return cached;
  const sanitized = sanitizeHTML(document.documentElement);
  const cartSnap = await consumeCartSnapshot(domain);
  return generateConfig(domain, 'shop', sanitized, cartSnap?.maskedHtml);
}

/**
 * 캐시된 config로 장바구니에서 상품명·가격을 파싱한다. 결과가 부실하면 자가 치유 발동:
 *   1) 페이지에 가격 패턴이 있는지 확인 — 빈 장바구니면 stale 아님 → 발동 안 함
 *   2) tryHeal로 즉시 AI 재호출 (cart 페이지 자체 HTML로 generateConfig)
 *   3) 새 셀렉터로 재파싱 → 성공이면 success 보고, 실패는 통계만 누적 (무한 루프 방지)
 */
async function tryParseCartAndHeal(
  domain: string,
  config: SiteConfig,
): Promise<void> {
  const fields = parseWithSelectors(document, config.selectors);
  if (hasCriticalFields(fields)) {
    await reportSuccess(config.id);
    return;
  }
  // 빈 카트면 셀렉터 stale 아님 — 사용자가 아직 안 담은 것
  if (!hasCartPriceSignal(document)) return;

  const healed = await tryHeal({
    domain,
    type: 'shop',
    failedConfig: config,
    root: document.documentElement,
  });
  if (!healed) return;
  const second = parseWithSelectors(document, healed.selectors);
  if (hasCriticalFields(second)) await reportSuccess(healed.id);
}

/**
 * 마스킹 HTML을 background로 전달 → background가 chrome.storage.local에 저장.
 * navigation 직전에도 안전하도록 sendMessage(fire-and-forget) 사용.
 */
function captureCartHtml(domain: string): void {
  try {
    const maskedHtml = sanitizeHTML(document.documentElement);
    const payload: CartHtmlSnapshot = {
      domain,
      url: location.href,
      maskedHtml,
      capturedAt: Date.now(),
    };
    chrome.runtime.sendMessage({ type: 'CART_HTML_SNAPSHOT', payload });
  } catch (err) {
    console.debug('[ZOAS] cart HTML 캡처 실패:', err);
  }
}

/**
 * 장바구니 페이지에서 form submit 시점에 마스킹 HTML을 재캡처(덮어쓰기).
 * capture-phase로 form 기본 submit 직전에 동기적으로 DOM을 읽는다.
 * (사용자가 수량 변경·쿠폰 적용한 최신 상태가 전달되도록.)
 */
function bindCartFormSubmit(domain: string): void {
  document.addEventListener(
    'submit',
    () => captureCartHtml(domain),
    true, // capture phase
  );
}

/** 완료 페이지: 클릭 스냅샷을 소비·병합해 최종 주문을 저장하고 자가치유에 결과를 보고. */
async function captureCompletion(
  domain: string,
  config: SiteConfig,
  fields: ReturnType<typeof parseWithSelectors>,
): Promise<void> {
  const snap = await consumeSnapshot(domain);
  const merged = mergeCapture(fields, snap);
  const order = buildPendingOrder({
    id: crypto.randomUUID(),
    domain,
    url: location.href,
    fields: merged,
  });
  await savePendingOrder(order);
  // 주문번호를 잡았으면 config가 완료 페이지에서 제 역할을 한 것 → 성공 피드백.
  await reportParseOutcome(config, Boolean(merged.orderNumber));
}

/**
 * 결제 직전 페이지: payButton 클릭 순간 현재 화면을 스냅샷으로 덮어쓴다.
 * capture-phase 리스너라 페이지 navigation 전에 동기적으로 DOM을 읽는다.
 * (navigation 직전 async storage write race는 알려진 한계 — 추후 background 메시지로 보강.)
 */
function bindPayClick(domain: string, config: SiteConfig): void {
  const sel = config.selectors.payButton;
  if (!sel) return;
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element | null;
      if (!target?.closest(sel)) return;
      const fields = parseWithSelectors(document, config.selectors);
      void saveSnapshot(domain, location.href, fields);
    },
    true, // capture phase
  );
}

/** 셀렉터가 현재 문서에서 실제로 매칭되는지 (잘못된 셀렉터는 false). */
function matches(selector: string | undefined): boolean {
  if (!selector) return false;
  try {
    return document.querySelector(selector) !== null;
  } catch {
    return false;
  }
}
