/**
 * 클라이언트 HTML 마스킹.
 * Worker로 보내기 전에 모든 텍스트 노드를 placeholder로 치환한다.
 * CSS 클래스와 태그 구조는 보존하되, 실 사용자 데이터는 0% 전송.
 *
 * 기술명세서 §4.1, §10 참고.
 */

const CURRENCY_RE = /^[¥$€₩£]?[\d,]+(\.\d+)?[\s円원元]?$/;
const NUMBER_RE = /^\d+$/;
const ID_RE = /^[\w-]{8,20}$/;
const EMAIL_RE = /@/;
const PHONE_RE = /^[\d\-+()\s]+$/;

export function classify(rawText: string): string {
  const text = rawText.trim();
  if (text.length === 0) return rawText; // whitespace는 그대로 보존

  if (CURRENCY_RE.test(text)) return `[CURRENCY_${detectCurrency(text)}]`;
  if (NUMBER_RE.test(text)) return `[NUMBER_${text.length}]`;
  if (ID_RE.test(text) && /\d/.test(text)) return `[ID_${text.length}]`;
  if (EMAIL_RE.test(text)) return '[EMAIL]';
  if (PHONE_RE.test(text) && text.length >= 9) return '[PHONE]';
  if (text.length > 50)
    return `[LONGTEXT_${detectLang(text)}_${text.length}]`;
  return `[TEXT_${detectLang(text)}_${text.length}]`;
}

export function detectCurrency(text: string): string {
  if (text.includes('¥') || text.includes('円')) return 'JPY';
  if (text.includes('$')) return 'USD';
  if (text.includes('€')) return 'EUR';
  if (text.includes('₩') || text.includes('원')) return 'KRW';
  if (text.includes('£')) return 'GBP';
  if (text.includes('元')) return 'CNY';
  return 'UNK';
}

export function detectLang(text: string): string {
  if (/[぀-ヿ]/.test(text)) return 'ja';
  if (/[가-힯]/.test(text)) return 'ko';
  if (/[一-鿿]/.test(text)) return 'zh';
  if (/[a-zA-Z]/.test(text)) return 'en';
  return 'xx';
}

/** DOM 트리를 받아 텍스트 노드를 placeholder로 치환한 sanitized HTML 문자열을 반환. */
export function sanitizeHTML(root: Element): string {
  const cloned = root.cloneNode(true) as Element;
  walkAndMask(cloned);
  stripUnsafeAttrs(cloned);
  return cloned.outerHTML;
}

function walkAndMask(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node as Text;
    t.data = classify(t.data);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  // <script>, <style> 내용은 통째로 제거 (코드/스타일은 분석 대상 아님)
  if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') {
    el.textContent = '';
    return;
  }
  for (const child of Array.from(node.childNodes)) walkAndMask(child);
}

function stripUnsafeAttrs(root: Element): void {
  // value, href, src 같은 사용자 데이터가 담길 수 있는 속성 제거.
  // class, id, data-* 같은 구조 식별 속성은 보존.
  const KEEP = /^(class|id|data-|aria-|role|name|type|placeholder)/i;
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (!KEEP.test(attr.name)) el.removeAttribute(attr.name);
    }
  }
}

/** Worker 측 검증과 동일 — placeholder 비율이 낮으면 마스킹 실패로 간주. */
export function maskedRatio(html: string): number {
  const total = html.length;
  if (total === 0) return 1;
  const placeholders = (html.match(/\[(?:CURRENCY|NUMBER|ID|EMAIL|PHONE|TEXT|LONGTEXT)_/g) ?? []).length;
  // 휴리스틱: placeholder가 100자당 1개 미만이면 의심
  return placeholders / Math.max(total / 100, 1);
}
