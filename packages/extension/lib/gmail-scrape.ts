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
