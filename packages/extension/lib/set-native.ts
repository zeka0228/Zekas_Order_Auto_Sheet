/**
 * React/Vue 같은 controlled-input 프레임워크가 관리하는 input/textarea/select에
 * 프로그래밍 방식으로 값을 주입하려면 native setter를 직접 호출해야 한다.
 * 그렇지 않으면 onChange가 트리거되지 않아 프레임워크 상태가 갱신되지 않는다.
 */
export function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  const setter = desc?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
