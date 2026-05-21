import { getCachedConfig, generateConfig } from '../lib/config-client';
import { sanitizeHTML } from '../lib/html-masker';
import { parseWithSelectors } from '../lib/checkout-parser';
import {
  saveSnapshot,
  consumeSnapshot,
  mergeCapture,
  buildPendingOrder,
} from '../lib/order-snapshot';
import { savePendingOrder } from '../lib/storage';
import { reportParseOutcome } from '../lib/self-healing';
import {
  looksLikeCheckoutOrCompletion,
  decidePageRole,
} from '../lib/checkout-flow';
import type { SiteConfig } from '../lib/schemas';

/**
 * 결제 캡처 (설계 진화 로그 §1.5 — 결제 클릭 스냅샷 + 완료 페이지 병합).
 *
 * 흐름:
 *   1) 값싼 게이트로 결제·완료 페이지일 법한지 확인
 *   2) config 확보 (캐시 → 없으면 마스킹 후 AI 생성)
 *   3) 역할 판정:
 *      - 완료 페이지: 파싱 → 클릭 스냅샷 소비·병합 → 저장 → 자가치유 피드백
 *      - 결제 직전 페이지: payButton 클릭에 리스너 부착 → 클릭 시 스냅샷 덮어쓰기
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle', // U5: 완료 페이지를 빨리 닫아도 잡히도록
  allFrames: true,
  async main() {
    if (!looksLikeCheckoutOrCompletion(document, location.href)) return;

    const domain = location.hostname;
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

/** 캐시된 config가 있으면 사용, 없으면 마스킹 HTML로 AI 생성. */
async function resolveConfig(domain: string): Promise<SiteConfig | null> {
  const cached = await getCachedConfig(domain, 'shop');
  if (cached) return cached;
  const sanitized = sanitizeHTML(document.documentElement);
  return generateConfig(domain, 'shop', sanitized);
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
