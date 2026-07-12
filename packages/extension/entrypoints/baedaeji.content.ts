import { getCachedConfig, generateConfig } from '../lib/config-client';
import { sanitizeHTML } from '../lib/html-masker';
import { listPendingOrders, getSettings } from '../lib/storage';
import { shouldActivateBaedaeji } from '../lib/baedaeji-gate';
import { fillOrderIntoForm } from '../lib/baedaeji-fill';
import { renderBaedaejiPanel } from '../lib/baedaeji-panel';
import { showScanNotification } from '../lib/scan-notification';
import type { SiteConfig } from '../lib/schemas';
import type { PendingOrder } from '../lib/schemas';

/**
 * 배대지 주문서 폼 자동 채움 (Phase 4).
 *
 * 흐름:
 *   1) 사용자 등록 배대지 도메인 + 채울 수 있는 폼이 있는 페이지인지 확인 (shouldActivateBaedaeji).
 *      배대지는 개인당 고정 1개라 등록 도메인에서만 활성화 → 오탐 0.
 *   2) 캡처된 pending order가 있으면 우상단 선택 패널 주입
 *   3) 사용자가 "채우기"를 누르면 그때 config 확보(캐시 → 없으면 AI 생성) 후 폼에 값 주입
 *   4) **자동 제출은 절대 하지 않는다** — 값만 채우고 검토·제출은 사용자 손에 맡긴다(명세서 §8).
 *      채운 필드·검토 필요 필드 수를 toast로 안내.
 *
 * config는 클릭 시점에 lazy 확보 — 배대지 페이지를 열기만 하고 채우지 않는 경우 AI 비용 0.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main() {
    const { baedaejiDomains } = await getSettings();
    if (
      !shouldActivateBaedaeji({
        host: location.hostname,
        doc: document,
        registeredDomains: baedaejiDomains,
      })
    )
      return;

    const orders = await listPendingOrders();
    if (orders.length === 0) return; // 채울 주문이 없으면 조용히 종료 — 패널 미주입

    renderBaedaejiPanel(orders, (order) => {
      void handleFill(location.hostname, order);
    });
  },
});

/** 선택된 주문으로 폼을 채운다: config 확보 → fillOrderIntoForm → 결과 toast. */
async function handleFill(domain: string, order: PendingOrder): Promise<void> {
  showScanNotification('scanning', 1500, '배대지 폼 채우는 중');
  const config = await resolveBaedaejiConfig(domain);
  if (!config) {
    showScanNotification('error', 3000, '폼 구조 분석 실패 · 수동 입력 필요');
    return;
  }
  const report = fillOrderIntoForm(document, config, order);
  if (report.filled.length === 0) {
    showScanNotification('error', 3000, '채운 필드 없음 · 수동 입력 필요');
    return;
  }
  const suffix =
    report.missing.length > 0 ? ` · ${report.missing.length}개 검토 필요` : '';
  showScanNotification(
    'completed',
    3500,
    `${report.filled.length}개 채움${suffix} · 검토 후 직접 제출`,
  );
}

/** 배대지 config를 캐시에서, 없으면 마스킹 HTML로 AI 생성. */
async function resolveBaedaejiConfig(domain: string): Promise<SiteConfig | null> {
  const cached = await getCachedConfig(domain, 'baedaeji');
  if (cached) return cached;
  const sanitized = sanitizeHTML(document.documentElement);
  return generateConfig(domain, 'baedaeji', sanitized);
}
