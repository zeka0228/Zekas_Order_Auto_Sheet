/**
 * 들어온 HTML이 충분히 마스킹되었는지 검증.
 * 기술명세서 §11.2 S9 — 마스킹 안 된 HTML이 Worker를 통과하는 사고 방지.
 */
const PLACEHOLDER_RE = /\[(?:CURRENCY|NUMBER|ID|EMAIL|PHONE|TEXT|LONGTEXT)_/g;

const MIN_PLACEHOLDER_RATIO = 0.3; // 100자당 0.3개 이상의 placeholder
const MIN_LENGTH = 200;             // 너무 짧으면 분석 의미 없음

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
