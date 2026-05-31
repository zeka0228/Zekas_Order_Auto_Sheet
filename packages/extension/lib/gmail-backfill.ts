/**
 * 열람 시 백필 오케스트레이션 (§1.9 + v1.7.1 잘린 본문 펼치기).
 *
 * gmail-scrape(DOM 추출)와 order-email(순수 매칭)을 잇는 글루. content script의 tryBackfill에서
 * 떼어내 doc·candidates·fetchFullText를 주입받게 했다 — chrome/네트워크/타이머를 직접 만지지 않아
 * 단위 테스트로 "클립 감지 → view=lg fetch → 전체 본문 재시도 → 백필" 전 경로를 검증할 수 있다.
 */
import { findFullMessageUrl, scrapeOpenEmail } from './gmail-scrape';
import {
  type Backfill,
  type BackfillCandidate,
  backfillFromOpenEmail,
  domainMatches,
  extractOrderNumber,
} from './order-email';

export interface BackfillOnOpenDeps {
  /** 열린 Gmail 문서 (content script는 document, 테스트는 happy-dom). */
  doc: ParentNode;
  /** orderNumber가 아직 빈 후보 주문들. */
  candidates: BackfillCandidate[];
  /** view=lg 전체-메일 URL을 받아 본문 텍스트로 푸는 fetcher (DOM·네트워크 격리용 주입점). */
  fetchFullText: (url: string) => Promise<string>;
}

/**
 * 열린 메일 1건으로 백필을 시도한다.
 *
 * 1) 열린 메일 스크랩 → backfillFromOpenEmail. 맞으면 그대로 반환.
 * 2) 못 맞췄고(부분 본문에서 번호 미추출) 본문이 잘렸고(view=lg 링크 존재) 도메인 일치 후보가
 *    있을 때만 전체 본문을 받아 한 번 더 시도. 도메인 일치 후보가 없으면 fetch하지 않는다(헛수고 회피).
 *
 * fetch 실패(빈 문자열)·번호 여전히 미추출이면 null — 백필을 못 할 뿐 잘린 본문 기준 동작에서 퇴보 없음.
 */
export async function backfillOnOpenEmail(deps: BackfillOnOpenDeps): Promise<Backfill | null> {
  const { doc, candidates, fetchFullText } = deps;
  if (candidates.length === 0) return null;
  const email = scrapeOpenEmail(doc);
  if (!email) return null;

  const hit = backfillFromOpenEmail(candidates, email);
  if (hit) return hit;

  // 잘린 본문 펼치기 (v1.7.1): 부분 본문에 번호가 아예 없고, 잘림 신호(view=lg 링크)가 있고,
  // 도메인 일치 후보가 있을 때만 전체 본문을 가져온다. 번호가 있는데 hit이 null이면(도메인 불일치 등)
  // 전체 본문도 도움이 안 되므로 fetch하지 않는다.
  if (extractOrderNumber(`${email.subject}\n${email.bodyText}`)) return null;
  if (!candidates.some((c) => domainMatches(c.domain, email.from))) return null;
  const fullUrl = findFullMessageUrl(doc);
  if (!fullUrl) return null;

  const fullText = await fetchFullText(fullUrl);
  if (!fullText) return null;
  return backfillFromOpenEmail(candidates, { ...email, bodyText: fullText });
}
