/**
 * 열린 Gmail 메일에서 발신/제목/본문을 추출 (열람 시 백필, §1.9).
 *
 * 실측 구조 (asobistore 주문확인 메일, 2026-05-30 캡처 기준):
 *   - 발신: 헤더 `h3` 안의 `span[email="..."]` (class `gD`).
 *   - 제목: `h2.hP`.
 *   - 본문: `.a3s` (긴 메일은 "[메일 내용 잘림]"으로 클립되지만, asobistore는 주문번호가
 *     본문 앞부분이라 영향 없음).
 *
 * receivedAt은 열람-시-백필(backfillFromOpenEmail)에서 쓰지 않으므로 0으로 둔다 —
 * Gmail의 로컬라이즈된 날짜("2022. 8. 19. 오후 5:12") 파싱을 피한다.
 *
 * 리스트 스크랩이 아니라 "열린 메일 1건"만 읽는다 — Gmail 리스트 DOM은 난독화·불안정하지만
 * 본문(`.a3s`)·발신(`span[email]`)·제목(`h2.hP`)은 수년째 안정적이라 깨질 위험이 작다.
 */
import type { EmailSummary } from './order-email';

export function scrapeOpenEmail(root: ParentNode = document): EmailSummary | null {
  const body = root.querySelector('.a3s');
  if (!body) return null;
  const from =
    root.querySelector('h3 span[email]')?.getAttribute('email') ??
    root.querySelector('span.gD[email]')?.getAttribute('email') ??
    '';
  if (!from) return null;
  const subject = root.querySelector('h2.hP')?.textContent?.trim() ?? '';
  const bodyText = body.textContent ?? '';
  return { from, subject, receivedAt: 0, bodyText };
}

/**
 * 잘린 메일의 "전체 메일 보기" 링크 URL을 찾는다 (§1.9 후속 — 잘린 본문 펼치기).
 *
 * Gmail은 본문이 일정 크기(≈102KB)를 넘으면 `.a3s`를 잘라내고 "[메일 내용 잘림] 전체 메일 보기"를
 * 덧붙인다. 그 링크는 표준 standalone 뷰(`?view=lg&permmsgid=…`, 잘리지 않은 전체 본문)를 가리키며
 * mail.google.com 동일 출처라 content script에서 fetch로 받을 수 있다. 링크의 존재 자체가 "본문이
 * 잘렸다"는 신호이므로 로캘 의존 마커 텍스트("[메일 내용 잘림]")는 보지 않는다 — `view=lg`는 로캘 불변.
 *
 * mail.google.com 호스트의 `view=lg` 링크만 반환한다(임의 출처 fetch 방지). 못 찾으면 null
 * (=안 잘렸거나 링크 없음). 호출측은 부분 본문에서 번호를 못 뽑았을 때만 이 URL을 받아 재시도한다.
 */
export function findFullMessageUrl(root: ParentNode = document): string | null {
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href*="view=lg"]')) {
    if (/^https:\/\/mail\.google\.com\/.*[?&]view=lg(?:&|#|$)/.test(a.href)) return a.href;
  }
  return null;
}

/**
 * 전체-메일 뷰(view=lg) HTML 문서에서 본문 텍스트를 뽑는다 (§1.9 후속).
 *
 * standalone 뷰는 잘리지 않은 본문을 담는다. `.a3s`가 있으면 그것을, 없으면 문서 전체 텍스트로
 * 폴백한다 — 주문번호 추출(extractOrderNumber)은 라벨 앵커 regex라 주변 잡음이 섞여도 무해하므로
 * 뷰 구조 변화에 보수적으로 넓게 잡는다.
 */
export function extractFullBodyText(doc: Document): string {
  const main = doc.querySelector('.a3s') ?? doc.body;
  return main?.textContent ?? '';
}
