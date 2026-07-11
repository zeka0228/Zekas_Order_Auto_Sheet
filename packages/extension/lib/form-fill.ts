/**
 * 배대지 주문서 폼 자동 채움의 순수 핵심 (Phase 4).
 *
 * `parseWithSelectors`(읽기)의 역방향: config.selectors(필드명 → CSS)와 값 맵을 받아
 * 매칭되는 input/textarea/select에 값을 주입한다. React/Vue controlled 폼도 갱신되도록
 * `setNativeValue`를 쓴다.
 *
 * 설계 원칙 (명세서 §8 면책 핵심):
 *   - **자동 제출은 절대 하지 않는다.** 여기서는 값만 채우고, 최종 제출은 사용자 손가락에 맡긴다.
 *   - 못 채운 필드(셀렉터 없음·요소 없음·드롭다운 매칭 실패)는 report로 돌려 UI가 "수동 입력
 *     필요"를 표시하도록 한다 — 조용히 삼키지 않는다.
 */
import { setNativeValue } from './set-native';

/** 채우면 안 되는 input type (체크박스·파일·버튼류·hidden). */
const SKIP_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'file',
  'submit',
  'button',
  'image',
  'reset',
  'hidden',
]);

export interface FillReport {
  /** 값이 실제로 주입된 필드명. */
  filled: string[];
  /**
   * 값은 있었으나 채우지 못한 필드명 — 셀렉터 미설정, 요소 못 찾음, 또는 select에서
   * 매칭 옵션이 없어 사용자가 직접 골라야 하는 경우. UI가 강조해 검토를 유도한다.
   */
  missing: string[];
}

/**
 * selectors(필드 → CSS)로 root에서 폼 요소를 찾아 values를 주입한다.
 *
 * values에 있는 (비지 않은) 필드만 시도한다. 각 필드는 filled 또는 missing 중 하나로 분류된다.
 * 값이 없는 필드는 시도하지 않는다(리포트에도 안 넣음).
 */
export function fillFormFields(
  root: ParentNode,
  selectors: Record<string, string>,
  values: Record<string, string | undefined>,
): FillReport {
  const filled: string[] = [];
  const missing: string[] = [];

  for (const [field, rawValue] of Object.entries(values)) {
    const value = rawValue?.trim();
    if (!value) continue; // 채울 값이 없으면 조용히 건너뜀

    const selector = selectors[field];
    if (!selector) {
      missing.push(field);
      continue;
    }
    const el = safeQuery(root, selector);
    if (!isFillable(el)) {
      missing.push(field);
      continue;
    }
    if (applyValue(el, value)) filled.push(field);
    else missing.push(field);
  }

  return { filled, missing };
}

/** 잘못된 셀렉터 문자열(깨진 AI 셀렉터)이 throw하지 않도록 방어. */
function safeQuery(root: ParentNode, selector: string): Element | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

type Fillable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isFillable(el: Element | null): el is Fillable {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return true;
  }
  if (el instanceof HTMLInputElement) {
    return !SKIP_INPUT_TYPES.has(el.type.toLowerCase());
  }
  return false;
}

/**
 * 요소에 값을 주입한다. select는 값·옵션 텍스트로 매칭되는 option이 있을 때만 채운다
 * (없으면 false → 사용자가 직접 선택). input/textarea는 그대로 주입.
 */
function applyValue(el: Fillable, value: string): boolean {
  if (el instanceof HTMLSelectElement) {
    const option = matchOption(el, value);
    if (!option) return false;
    setNativeValue(el, option.value);
    return true;
  }
  setNativeValue(el, value);
  return true;
}

/** select에서 값(option value) 또는 표시 텍스트로 매칭되는 option을 찾는다. 대소문자 무시 텍스트 매칭 폴백. */
function matchOption(el: HTMLSelectElement, value: string): HTMLOptionElement | null {
  const options = Array.from(el.options);
  const exact = options.find((o) => o.value === value);
  if (exact) return exact;
  const byText = options.find((o) => o.textContent?.trim() === value);
  if (byText) return byText;
  const lower = value.toLowerCase();
  const byTextCI = options.find(
    (o) => o.textContent?.trim().toLowerCase() === lower,
  );
  return byTextCI ?? null;
}
