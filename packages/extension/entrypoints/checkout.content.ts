import { getCachedConfig, generateConfig, reportSuccess } from '../lib/config-client';
import { sanitizeHTML } from '../lib/html-masker';
import { parseWithSelectors, hasCriticalFields } from '../lib/checkout-parser';
import { buildPendingOrder } from '../lib/order-snapshot';
import {
  consumeCartSnapshot,
  type CartHtmlSnapshot,
} from '../lib/cart-html-snapshot';
import { tryHeal } from '../lib/self-healing';
import {
  looksLikeCheckoutOrCompletion,
  isCartPage,
  hasCartPriceSignal,
} from '../lib/checkout-flow';
import { isDomesticSite } from '../lib/domestic-site-gate';
import { showScanNotification } from '../lib/scan-notification';
import type { SiteConfig } from '../lib/schemas';

/**
 * 결제 캡처 (설계 진화 로그 §1.5 → §1.9 갱신: 완료 페이지 폐기).
 *
 * 흐름:
 *   1) 값싼 게이트로 결제 흐름 페이지일 법한지 확인 (다국어 키워드)
 *   2) 국내 사이트 차단 게이트 (해외 직구만 처리)
 *   3) 장바구니 페이지면 마스킹 HTML 누적 (진입 + form submit) 후 종료 — AI 호출 안 함
 *   4) 그 외(결제 직전) 페이지: config 확보 (캐시 → 없으면 AI 생성, cart snapshot 동반)
 *   5) payButton 클릭 시 현재 화면의 상품·가격을 candidate PendingOrder로 즉시 저장.
 *      orderNumber는 비워 둔다 — 완료 페이지 캡처는 폐기했고, orderNumber·결제성공은
 *      주문확인 이메일에서 백필한다(§1.9). navigation race 회피 위해 background 경유.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle', // U5: 완료 페이지를 빨리 닫아도 잡히도록
  // 일부 쇼핑몰은 결제 단계 폼·완료 화면을 PG사 iframe 안에 렌더한다.
  // 메인 프레임에만 주입하면 그 영역의 DOM·submit·payButton 클릭을 전부 놓침.
  // 게이트(looksLikeCheckoutOrCompletion)가 각 프레임에서 다시 판정하므로
  // 무관한 광고 iframe까지 들어가도 즉시 빠져나옴 → 비용 거의 0.
  allFrames: true,
  async main() {
    // 수동 스캔(popup "스캔 시작")은 자동 게이트가 놓친 페이지(SPA 미니카트 등)를
    // 사용자가 직접 구제하기 위한 길. 따라서 리스너는 게이트 return *이전에*, 그리고
    // top frame에서만 등록 — allFrames라 모든 프레임이 등록하면 한 번 클릭에 중복 캡처·토스트.
    if (window.top === window) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if ((msg as { type?: string } | null)?.type !== 'SCAN_NOW') return false;
        void handleManualScan(location.hostname).then(sendResponse);
        return true; // 비동기 sendResponse
      });
    }

    if (!looksLikeCheckoutOrCompletion(document, location.href)) return;
    if (isDomesticSite(document, location.href)) {
      console.debug('[ZOAS] 국내 사이트로 판정 — 캡처/AI 호출 스킵:', location.hostname);
      return;
    }

    const domain = location.hostname;

    if (isCartPage(location.href)) {
      // 장바구니: 마스킹 HTML 누적 + (캐시가 있으면) 셀렉터 자가 치유 검증
      showScanNotification('recognized');
      captureCartHtml(domain);
      bindCartFormSubmit(domain);
      const cached = await getCachedConfig(domain, 'shop');
      if (cached) await tryParseCartAndHeal(domain, cached);
      return;
    }

    // 결제 직전(체크아웃) 페이지: payButton 클릭 시 candidate PendingOrder를 캡처.
    // 완료 페이지는 더는 보지 않음 — orderNumber·결제성공은 주문확인 이메일 백필(§1.9).
    const config = await resolveConfig(domain);
    if (!config) return;
    bindPayClick(domain, config);
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
 * 수동 스캔 (popup "스캔 시작" → SCAN_NOW): 현재 페이지의 마스킹 HTML을 무조건 누적한다.
 *
 * 설계 (진화 로그 §1.8):
 *   - 여기선 AI 호출 안 함 — 사용자가 잘못된 페이지에서 눌러도 비용·오염 0.
 *     실제 AI/캐시 처리는 submit·완료 페이지 진입 시 자동 흐름(resolveConfig)과 합류.
 *   - 자동 인식 안 되는 페이지도 일단 캡처(SPA 미니카트 등 구제가 목적).
 *     단 장바구니로 확인되지 않으면(가격신호·cart URL 모두 없음) 그 사실을 알림으로 안내.
 *   - 알림은 자동 흐름과 동일한 상태 재사용(scanning→completed). 비확인 케이스만 문구로 구분.
 */
async function handleManualScan(domain: string): Promise<{ looksLikeCart: boolean }> {
  showScanNotification('scanning', 1500);
  captureCartHtml(domain);
  const looksLikeCart = isCartPage(location.href) || hasCartPriceSignal(document);
  if (looksLikeCart) {
    showScanNotification('completed');
  } else {
    showScanNotification(
      'error',
      3000,
      '캡처함 · 장바구니 페이지인지 확인 필요',
    );
  }
  return { looksLikeCart };
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
    () => {
      showScanNotification('scanning', 1500);
      captureCartHtml(domain);
    },
    true, // capture phase
  );
}

/**
 * 결제 직전 페이지: payButton 클릭 순간 현재 화면의 상품·가격을 candidate PendingOrder로
 * 저장한다(orderNumber는 비움 — 이메일 백필, §1.9). capture-phase로 navigation 전에
 * 동기적으로 DOM을 읽고, 저장은 background로 fire-and-forget — navigation 직전 직접
 * storage write의 race를 피한다 (CART_HTML_SNAPSHOT과 동일 패턴).
 */
function bindPayClick(domain: string, config: SiteConfig): void {
  const sel = config.selectors.payButton;
  if (!sel) return;
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element | null;
      if (!target?.closest(sel)) return;
      try {
        const fields = parseWithSelectors(document, config.selectors);
        const order = buildPendingOrder({
          id: crypto.randomUUID(),
          domain,
          url: location.href,
          fields,
        });
        chrome.runtime.sendMessage({ type: 'PENDING_ORDER', payload: order });
      } catch (err) {
        console.debug('[ZOAS] 결제 클릭 캡처 실패:', err);
      }
    },
    true, // capture phase
  );
}
