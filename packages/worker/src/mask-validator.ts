/**
 * 들어온 HTML이 충분히 마스킹되었는지 검증.
 * 기술명세서 §11.2 S9 — 마스킹 안 된 HTML이 Worker를 통과하는 사고 방지.
 */
const PLACEHOLDER_RE = /\[(?:CURRENCY|NUMBER|ID|EMAIL|PHONE|TEXT|LONGTEXT)_/g;

// 실측 기준: 정상 마스킹된 결제/완료 페이지는 100자당 0.5~2개의 placeholder.
// 0.3은 "광범위한 평문이 통과했을 가능성"의 보수적 하한 — 더 높이면
// 정상 페이지(예: 텍스트가 적은 결제 완료 화면)를 false negative로 떨굴 위험.
const MIN_PLACEHOLDER_RATIO = 0.3;
// 200자 미만이면 비율 자체가 흔들려 의미 없음. 빈 페이지·404 같은 비정상 입력 차단도 겸함.
const MIN_LENGTH = 200;

export function validateMasking(html: string): boolean {
  if (html.length < MIN_LENGTH) return false;
  const placeholders = (html.match(PLACEHOLDER_RE) ?? []).length;
  const ratio = placeholders / Math.max(html.length / 100, 1);
  if (ratio < MIN_PLACEHOLDER_RATIO) return false;

  // 매우 약한 휴리스틱: 흔한 PII 패턴이 평문으로 남아 있는지 추가 검사
  if (/\b\d{3}-\d{3,4}-\d{4}\b/.test(html)) return false;         // 전화 형식
  if (/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(html)) return false; // 이메일
  return true;
}
