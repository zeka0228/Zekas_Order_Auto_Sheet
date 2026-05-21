import { describe, expect, it } from 'vitest';
import { extractJsonObject } from './ai-proxy';

/**
 * BUG-011: Haiku가 "코드 펜스 금지" 지시에도 ```json …``` 으로 감싸거나 앞뒤 설명을 붙여
 * JSON.parse가 깨지던 문제. extractJsonObject가 펜스·잡음을 벗겨야 한다.
 */
describe('extractJsonObject', () => {
  it('순수 JSON 객체는 그대로', () => {
    expect(extractJsonObject('{"orderNumber":".a"}')).toBe('{"orderNumber":".a"}');
  });

  it('```json 코드 펜스를 벗긴다', () => {
    const fenced = '```json\n{"price":".p","payButton":"#pay"}\n```';
    expect(extractJsonObject(fenced)).toBe('{"price":".p","payButton":"#pay"}');
  });

  it('언어 없는 ``` 펜스도 벗긴다', () => {
    expect(extractJsonObject('```\n{"a":"b"}\n```')).toBe('{"a":"b"}');
  });

  it('앞뒤 설명 텍스트가 있어도 객체만 추출', () => {
    const noisy = '다음은 셀렉터입니다:\n{"productName":".name"}\n도움이 되었길 바랍니다.';
    expect(extractJsonObject(noisy)).toBe('{"productName":".name"}');
  });

  it('중첩 객체는 가장 바깥 중괄호까지', () => {
    expect(extractJsonObject('{"a":{"b":"c"}}')).toBe('{"a":{"b":"c"}}');
  });

  it('객체가 없으면 null', () => {
    expect(extractJsonObject('JSON이 없습니다')).toBeNull();
    expect(extractJsonObject('```json\n[]\n```')).toBeNull(); // 배열만 → 객체 없음
  });

  it('추출 결과는 JSON.parse 가능', () => {
    const out = extractJsonObject('```json\n{"orderNumber":".o","price":".p"}\n```');
    expect(out).not.toBeNull();
    expect(JSON.parse(out as string)).toEqual({ orderNumber: '.o', price: '.p' });
  });
});
