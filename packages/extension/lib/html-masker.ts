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

/**
 * 셀렉터 생성과 무관해 AI 토큰만 잡아먹는 서브트리·노드를 제거한다.
 * <script>/<style>은 제외 — 내용은 walkAndMask가 비우고 태그만 남긴다(기존 동작 유지).
 * <nav>/<footer> 등은 주문 요약이 들어있을 수 있어 보수적으로 남긴다(추후 측정 후 재검토).
 */
const NOISE_TAGS = new Set([
  'HEAD', 'TITLE', 'LINK', 'META', 'BASE',
  'SVG', 'IFRAME', 'NOSCRIPT', 'TEMPLATE', 'CANVAS',
  'VIDEO', 'AUDIO', 'SOURCE', 'PICTURE', 'OBJECT', 'EMBED',
]);

/** root를 in-place로 정리: 노이즈 태그·주석·공백 전용 텍스트 노드 제거. */
export function pruneNoise(root: Element): void {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (NOISE_TAGS.has(el.tagName.toUpperCase())) {
        el.remove();
        continue;
      }
      pruneNoise(el);
    } else if (child.nodeType === Node.COMMENT_NODE) {
      child.parentNode?.removeChild(child);
    } else if (child.nodeType === Node.TEXT_NODE) {
      if ((child as Text).data.trim().length === 0) {
        child.parentNode?.removeChild(child);
      }
    }
  }
}

/** DOM 트리를 받아 텍스트 노드를 placeholder로 치환한 sanitized HTML 문자열을 반환. */
export function sanitizeHTML(root: Element): string {
  const cloned = root.cloneNode(true) as Element;
  pruneNoise(cloned); // 토큰 절감: 무관 서브트리·주석·공백 제거
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

const KEEP_ATTR = /^(class|id|data-|aria-|role|name|type|placeholder)/i;
/** 본질적으로 사람이 읽는 텍스트를 담는 속성 — 값을 항상 마스킹. */
const HUMAN_TEXT_ATTR = /^(aria-label|aria-description|aria-placeholder|placeholder|alt|title)$/i;

/** 보존 대상 속성이라도 값이 사람 텍스트/PII면 마스킹해야 한다. */
function looksLikePII(value: string): boolean {
  return (
    /@/.test(value) || // 이메일
    /\d{7,}/.test(value) || // 긴 숫자열 (전화·주문번호·ID)
    /[가-힯぀-ヿ一-鿿]/.test(value) || // CJK 사람 텍스트
    value.length > 40 // 긴 자유 텍스트
  );
}

function stripUnsafeAttrs(root: Element): void {
  // value, href, src, style 등 사용자 데이터가 담길 수 있는 속성은 제거.
  // class, id, data-* 같은 구조 식별 속성은 보존하되, 값이 PII면 placeholder로 치환.
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (!KEEP_ATTR.test(attr.name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      // 속성 이름(=셀렉터 식별자)은 유지하고, 사람 텍스트/PII 값만 마스킹.
      if (HUMAN_TEXT_ATTR.test(attr.name) || looksLikePII(attr.value)) {
        el.setAttribute(attr.name, classify(attr.value));
      }
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
