import { describe, expect, it } from 'vitest';
import {
  saveCartSnapshot,
  consumeCartSnapshot,
  peekCartSnapshot,
  type CartHtmlSnapshot,
} from './cart-html-snapshot';

function fakeArea(): chrome.storage.StorageArea & { store: Record<string, unknown> } {
  const store: Record<string, unknown> = {};
  return {
    store,
    async get(key: string) {
      return key in store ? { [key]: store[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, items);
    },
    async remove(key: string) {
      delete store[key];
    },
  } as unknown as chrome.storage.StorageArea & { store: Record<string, unknown> };
}

const snap = (overrides: Partial<CartHtmlSnapshot> = {}): CartHtmlSnapshot => ({
  domain: 'shop.jp',
  url: 'https://shop.jp/cart',
  maskedHtml: '<div>[TEXT_ja_10]</div>',
  capturedAt: 1000,
  ...overrides,
});

describe('cart-html-snapshot', () => {
  it('저장 후 소비하면 마스킹 HTML을 돌려준다', async () => {
    const area = fakeArea();
    const s = snap();
    await saveCartSnapshot(s, area);
    const got = await consumeCartSnapshot('shop.jp', 1000, area);
    expect(got).toEqual(s);
  });

  it('consume-once: 한 번 소비하면 사라진다', async () => {
    const area = fakeArea();
    await saveCartSnapshot(snap(), area);
    await consumeCartSnapshot('shop.jp', 1000, area);
    expect(await consumeCartSnapshot('shop.jp', 1000, area)).toBeNull();
  });

  it('덮어쓰기: submit 시점 캡처가 진입 캡처를 이긴다', async () => {
    const area = fakeArea();
    await saveCartSnapshot(snap({ maskedHtml: '<div>진입</div>', capturedAt: 1000 }), area);
    await saveCartSnapshot(snap({ maskedHtml: '<div>submit</div>', capturedAt: 2000 }), area);
    const got = await consumeCartSnapshot('shop.jp', 2000, area);
    expect(got?.maskedHtml).toBe('<div>submit</div>');
    expect(got?.capturedAt).toBe(2000);
  });

  it('TTL 초과는 null이고 삭제는 된다', async () => {
    const area = fakeArea();
    await saveCartSnapshot(snap({ capturedAt: 0 }), area);
    const FUTURE = 25 * 60 * 60_000; // 25h 후
    expect(await consumeCartSnapshot('shop.jp', FUTURE, area)).toBeNull();
    expect(Object.keys(area.store)).toHaveLength(0);
  });

  it('도메인별로 분리된다', async () => {
    const area = fakeArea();
    await saveCartSnapshot(snap({ domain: 'a.com', maskedHtml: 'A' }), area);
    await saveCartSnapshot(snap({ domain: 'b.com', maskedHtml: 'B' }), area);
    expect((await consumeCartSnapshot('a.com', 1000, area))?.maskedHtml).toBe('A');
    expect((await consumeCartSnapshot('b.com', 1000, area))?.maskedHtml).toBe('B');
  });

  it('peek은 소비하지 않는다', async () => {
    const area = fakeArea();
    await saveCartSnapshot(snap(), area);
    const peeked = await peekCartSnapshot('shop.jp', 1000, area);
    expect(peeked?.maskedHtml).toBe('<div>[TEXT_ja_10]</div>');
    // 여전히 consume 가능
    const consumed = await consumeCartSnapshot('shop.jp', 1000, area);
    expect(consumed).not.toBeNull();
  });

  it('peek도 TTL 초과면 null', async () => {
    const area = fakeArea();
    await saveCartSnapshot(snap({ capturedAt: 0 }), area);
    const FUTURE = 25 * 60 * 60_000;
    expect(await peekCartSnapshot('shop.jp', FUTURE, area)).toBeNull();
    // peek는 삭제 안 하므로 키 유지
    expect(Object.keys(area.store)).toHaveLength(1);
  });

  it('없는 도메인은 null', async () => {
    const area = fakeArea();
    expect(await consumeCartSnapshot('missing.com', 1000, area)).toBeNull();
    expect(await peekCartSnapshot('missing.com', 1000, area)).toBeNull();
  });
});
