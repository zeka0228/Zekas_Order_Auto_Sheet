import { describe, expect, it } from 'vitest';
import { validateMasking } from './mask-validator';

/**
 * Worker의 마지막 방어선. extension에서 마스킹 깨진 HTML이 잘못 도착하면
 * AI에 넘기기 전 400으로 반려해야 한다. (명세서 §11.2 S9)
 *
 * extension 쪽 html-masker.test.ts와 의도적으로 짝을 이룸:
 *   - extension은 "placeholder가 잘 만들어지는가"
 *   - worker는 "placeholder 없는 HTML이 들어오면 거절하는가"
 */
describe('validateMasking', () => {
  const wellMaskedHtml =
    '<div class="order">' +
    '<span class="id">[ID_18]</span>' +
    '<span class="price">[CURRENCY_JPY]</span>' +
    '<span class="email">[EMAIL]</span>' +
    '<span class="phone">[PHONE]</span>' +
    '<span class="name">[TEXT_ja_20]</span>' +
    '</div>'.repeat(5);

  it('충분히 마스킹된 HTML은 통과', () => {
    // ~200자 이상 + placeholder 비율 충분
    const padded = wellMaskedHtml + '[NUMBER_5]'.repeat(20);
    expect(padded.length).toBeGreaterThan(200);
    expect(validateMasking(padded)).toBe(true);
  });

  it('너무 짧은 입력은 reject (분석 의미 없음)', () => {
    expect(validateMasking('[ID_18]')).toBe(false);
    expect(validateMasking('<div>[CURRENCY_JPY]</div>')).toBe(false);
  });

  it('길이는 충분해도 placeholder 비율이 낮으면 reject', () => {
    const mostlyPlainText =
      '<div>이것은 마스킹되지 않은 평문 콘텐츠입니다. 충분히 길지만 placeholder는 거의 없습니다.</div>'.repeat(
        5,
      );
    expect(mostlyPlainText.length).toBeGreaterThan(200);
    expect(validateMasking(mostlyPlainText)).toBe(false);
  });

  it('평문 전화번호(NNN-NNNN-NNNN)가 살아 있으면 reject', () => {
    const leaked =
      wellMaskedHtml +
      '<span>고객 연락처: 010-1234-5678</span>' +
      '[NUMBER_5]'.repeat(20);
    expect(validateMasking(leaked)).toBe(false);
  });

  it('평문 이메일이 살아 있으면 reject', () => {
    const leaked =
      wellMaskedHtml + '<span>customer@example.com</span>' + '[NUMBER_5]'.repeat(20);
    expect(validateMasking(leaked)).toBe(false);
  });

  it('빈 문자열·null-ish 짧은 입력도 false', () => {
    expect(validateMasking('')).toBe(false);
    expect(validateMasking(' ')).toBe(false);
  });
});
