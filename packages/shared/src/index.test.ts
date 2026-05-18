import { describe, expect, it } from 'vitest';
import {
  ConfigTypeSchema,
  FeedbackRequestSchema,
  GenerateConfigRequestSchema,
  SiteConfigSchema,
} from './index';

describe('ConfigTypeSchema', () => {
  it('shop / baedaeji 두 값만 허용', () => {
    expect(ConfigTypeSchema.parse('shop')).toBe('shop');
    expect(ConfigTypeSchema.parse('baedaeji')).toBe('baedaeji');
  });

  it('다른 문자열은 reject', () => {
    expect(() => ConfigTypeSchema.parse('foo')).toThrow();
    expect(() => ConfigTypeSchema.parse('')).toThrow();
    expect(() => ConfigTypeSchema.parse(undefined)).toThrow();
    expect(() => ConfigTypeSchema.parse(null)).toThrow();
  });
});

describe('SiteConfigSchema', () => {
  const base = {
    id: 1,
    type: 'shop' as const,
    domain: 'example.com',
    urlPattern: '*',
    version: 1,
    selectors: { orderNumber: '.order' },
  };

  it('최소 필드만 있는 valid config 통과 (language/country 생략)', () => {
    const parsed = SiteConfigSchema.parse(base);
    expect(parsed.id).toBe(1);
    expect(parsed.language).toBeUndefined();
    expect(parsed.country).toBeUndefined();
  });

  it('BUG-005 회귀: worker가 보내는 null language/country도 통과', () => {
    const parsed = SiteConfigSchema.parse({
      ...base,
      language: null,
      country: null,
    });
    expect(parsed.language).toBeNull();
    expect(parsed.country).toBeNull();
  });

  it('string language/country도 통과', () => {
    const parsed = SiteConfigSchema.parse({
      ...base,
      language: 'ja',
      country: 'JP',
    });
    expect(parsed.language).toBe('ja');
    expect(parsed.country).toBe('JP');
  });

  it('selectors가 빈 객체여도 통과 (Record<string, string>)', () => {
    expect(() => SiteConfigSchema.parse({ ...base, selectors: {} })).not.toThrow();
  });

  it('필수 필드 누락 시 reject', () => {
    const { id: _id, ...withoutId } = base;
    expect(() => SiteConfigSchema.parse(withoutId)).toThrow();

    const { selectors: _s, ...withoutSelectors } = base;
    expect(() => SiteConfigSchema.parse(withoutSelectors)).toThrow();
  });

  it('잘못된 타입 reject (id가 string, version이 float, selectors가 array)', () => {
    expect(() => SiteConfigSchema.parse({ ...base, id: '1' })).toThrow();
    expect(() => SiteConfigSchema.parse({ ...base, version: 1.5 })).toThrow();
    expect(() => SiteConfigSchema.parse({ ...base, selectors: ['.order'] })).toThrow();
  });
});

describe('GenerateConfigRequestSchema', () => {
  const base = {
    domain: 'example.com',
    type: 'shop' as const,
    sanitized_html: '<div class="x">[ID_10]</div>',
  };

  it('최소 필드 valid', () => {
    expect(() => GenerateConfigRequestSchema.parse(base)).not.toThrow();
  });

  it('url_pattern 있는 경우도 valid', () => {
    expect(() =>
      GenerateConfigRequestSchema.parse({ ...base, url_pattern: '/checkout/*' }),
    ).not.toThrow();
  });

  it('빈 domain reject', () => {
    expect(() => GenerateConfigRequestSchema.parse({ ...base, domain: '' })).toThrow();
  });

  it('빈 sanitized_html reject', () => {
    expect(() =>
      GenerateConfigRequestSchema.parse({ ...base, sanitized_html: '' }),
    ).toThrow();
  });

  it('500_000자 초과 sanitized_html reject', () => {
    const tooLong = 'x'.repeat(500_001);
    expect(() =>
      GenerateConfigRequestSchema.parse({ ...base, sanitized_html: tooLong }),
    ).toThrow();
  });

  it('잘못된 type reject', () => {
    expect(() =>
      GenerateConfigRequestSchema.parse({ ...base, type: 'unknown' }),
    ).toThrow();
  });
});

describe('FeedbackRequestSchema', () => {
  it('success / failure outcome 모두 valid', () => {
    expect(() =>
      FeedbackRequestSchema.parse({ config_id: 1, outcome: 'success' }),
    ).not.toThrow();
    expect(() =>
      FeedbackRequestSchema.parse({ config_id: 1, outcome: 'failure' }),
    ).not.toThrow();
  });

  it('정수 아닌 config_id reject', () => {
    expect(() =>
      FeedbackRequestSchema.parse({ config_id: 1.5, outcome: 'success' }),
    ).toThrow();
    expect(() =>
      FeedbackRequestSchema.parse({ config_id: '1', outcome: 'success' }),
    ).toThrow();
  });

  it('정의되지 않은 outcome reject', () => {
    expect(() =>
      FeedbackRequestSchema.parse({ config_id: 1, outcome: 'partial' }),
    ).toThrow();
    expect(() =>
      FeedbackRequestSchema.parse({ config_id: 1, outcome: '' }),
    ).toThrow();
  });
});
