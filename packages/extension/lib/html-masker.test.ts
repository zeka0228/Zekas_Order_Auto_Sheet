import { describe, expect, it } from 'vitest';
import {
  classify,
  detectCurrency,
  detectLang,
  maskedRatio,
  pruneNoise,
  sanitizeHTML,
} from './html-masker';

describe('classify', () => {
  it('빈 문자열·whitespace는 원본 보존 (HTML 구조의 빈 공백)', () => {
    expect(classify('')).toBe('');
    expect(classify('   ')).toBe('   ');
    expect(classify('\n\t')).toBe('\n\t');
  });

  it('통화 기호 + 숫자 → [CURRENCY_*]', () => {
    expect(classify('¥3,850')).toBe('[CURRENCY_JPY]');
    expect(classify('$100.50')).toBe('[CURRENCY_USD]');
    expect(classify('€42')).toBe('[CURRENCY_EUR]');
    expect(classify('₩50,000')).toBe('[CURRENCY_KRW]');
    expect(classify('£9.99')).toBe('[CURRENCY_GBP]');
    expect(classify('3850円')).toBe('[CURRENCY_JPY]');
    expect(classify('100元')).toBe('[CURRENCY_CNY]');
    expect(classify('5000원')).toBe('[CURRENCY_KRW]');
  });

  it('이메일 → [EMAIL]', () => {
    expect(classify('user@example.com')).toBe('[EMAIL]');
    expect(classify('a+b@c.co.kr')).toBe('[EMAIL]');
  });

  it('영숫자 ID 패턴 (8~20자 + 숫자 포함) → [ID_n]', () => {
    expect(classify('A10232025092202215')).toBe('[ID_18]');
    expect(classify('ORD-2025-0001')).toBe('[ID_13]');
  });

  it('긴 텍스트 (>50자) → [LONGTEXT_lang_n]', () => {
    const ko =
      '서울특별시 강남구 테헤란로 123번지 어떤 빌딩 7층 어떤 사무실 우편번호 06234 받는사람 홍길동';
    expect(ko.length).toBeGreaterThan(50);
    expect(classify(ko)).toMatch(/^\[LONGTEXT_ko_\d+\]$/);
  });

  it('짧은 텍스트 → [TEXT_lang_n]', () => {
    expect(classify('주문하기')).toMatch(/^\[TEXT_ko_\d+\]$/);
    expect(classify('Checkout')).toMatch(/^\[TEXT_en_\d+\]$/);
    expect(classify('注文確認')).toMatch(/^\[TEXT_(ja|zh)_\d+\]$/);
  });
});

describe('detectCurrency', () => {
  it.each([
    ['¥3850', 'JPY'],
    ['3850円', 'JPY'],
    ['$100', 'USD'],
    ['€42', 'EUR'],
    ['₩5000', 'KRW'],
    ['5000원', 'KRW'],
    ['£9.99', 'GBP'],
    ['100元', 'CNY'],
    ['12345', 'UNK'],
  ])('%s → %s', (text, expected) => {
    expect(detectCurrency(text)).toBe(expected);
  });
});

describe('detectLang', () => {
  it.each([
    ['ありがとう', 'ja'],
    ['감사합니다', 'ko'],
    ['谢谢您', 'zh'],
    ['thank you', 'en'],
    ['1234567890', 'xx'],
  ])('%s → %s', (text, expected) => {
    expect(detectLang(text)).toBe(expected);
  });
});

describe('sanitizeHTML — 구조 보존', () => {
  it('class·id·data-*·aria-* 보존', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<section class="order" id="o1" data-test="x" aria-label="주문" role="region">hi</section>';
    const out = sanitizeHTML(root);
    expect(out).toContain('class="order"');
    expect(out).toContain('id="o1"');
    expect(out).toContain('data-test="x"');
    expect(out).toContain('role="region"');
    // aria-label은 속성 이름은 유지하되 사람 텍스트 값은 마스킹
    expect(out).toContain('aria-label=');
    expect(out).not.toContain('aria-label="주문"');
  });

  it('href / src / value 같은 사용자 데이터 attribute는 제거', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<a href="https://shop.example.com/orders/123" data-id="x">link</a>' +
      '<img src="https://cdn.example.com/u/avatar.png" />' +
      '<input value="고객 실명" placeholder="이름" />';
    const out = sanitizeHTML(root);
    expect(out).not.toContain('shop.example.com');
    expect(out).not.toContain('cdn.example.com');
    expect(out).not.toContain('고객 실명');
    expect(out).toContain('data-id="x"');
    // placeholder 속성 이름은 유지하되 사람 텍스트 값은 마스킹
    expect(out).toContain('placeholder=');
    expect(out).not.toContain('placeholder="이름"');
  });

  it('<script>·<style> 내용은 통째 제거', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<script>window.userEmail = "leak@example.com";</script>' +
      '<style>.x { color: red; }</style>' +
      '<p>본문</p>';
    const out = sanitizeHTML(root);
    expect(out).not.toContain('leak@example.com');
    expect(out).not.toContain('color: red');
    expect(out).toContain('<script>');
    expect(out).toContain('<style>');
  });
});

describe('sanitizeHTML — PII 비누설 (가장 중요)', () => {
  it('주문번호·상품명·가격·이메일·전화번호 모두 원문이 살아남지 않음', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="order">
        <span class="order-id">A10232025092202215</span>
        <span class="product-name">Anime Figure - Hatsune Miku 1/7 Scale</span>
        <span class="price">¥18,500</span>
        <span class="email">customer@example.com</span>
        <span class="phone">090-1234-5678</span>
      </div>
    `;
    const out = sanitizeHTML(root);

    expect(out).not.toContain('A10232025092202215');
    expect(out).not.toContain('Hatsune Miku');
    expect(out).not.toContain('18,500');
    expect(out).not.toContain('18500');
    expect(out).not.toContain('customer@example.com');
    expect(out).not.toContain('090-1234-5678');

    // 구조 식별자는 보존
    expect(out).toContain('class="order"');
    expect(out).toContain('class="order-id"');
    expect(out).toContain('class="price"');
    expect(out).toContain('class="email"');
  });

  it('중첩 깊은 구조에서도 텍스트가 살아남지 않음', () => {
    const root = document.createElement('section');
    root.innerHTML = `
      <ul>
        <li><div><span>실제 사용자 주소 광화문로 1번지</span></div></li>
        <li><div><span>another sensitive line here</span></div></li>
      </ul>
    `;
    const out = sanitizeHTML(root);
    expect(out).not.toContain('광화문');
    expect(out).not.toContain('sensitive');
  });
});

describe('sanitizeHTML — 속성 값 마스킹 (PII 누설 방지)', () => {
  it('aria-label / placeholder 같은 사람 텍스트 속성 값은 마스킹', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<button aria-label="山田太郎様の注文を確定">x</button>' +
      '<input placeholder="홍길동 이메일 입력" />';
    const out = sanitizeHTML(root);
    expect(out).not.toContain('山田太郎');
    expect(out).not.toContain('홍길동');
    // 속성 이름은 살아있어 [attr] 셀렉터는 여전히 동작
    expect(out).toContain('aria-label=');
    expect(out).toContain('placeholder=');
  });

  it('PII형 data-* 값(이메일·긴 숫자열)은 마스킹', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div data-user-id="100234567" data-email="leak@example.com">x</div>';
    const out = sanitizeHTML(root);
    expect(out).not.toContain('100234567');
    expect(out).not.toContain('leak@example.com');
    expect(out).toContain('data-user-id=');
    expect(out).toContain('data-email=');
  });

  it('의미 있는 구조 data-* 값(짧은 식별자)은 보존', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button data-testid="confirm-order" data-role="pay">x</button>';
    const out = sanitizeHTML(root);
    expect(out).toContain('data-testid="confirm-order"');
    expect(out).toContain('data-role="pay"');
  });

  it('enum 속성(role·type·aria-hidden)은 그대로', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<input type="text" role="textbox" aria-hidden="false" class="x" />';
    const out = sanitizeHTML(root);
    expect(out).toContain('type="text"');
    expect(out).toContain('role="textbox"');
    expect(out).toContain('aria-hidden="false"');
    expect(out).toContain('class="x"');
  });
});

describe('pruneNoise — 토큰 절감', () => {
  it('노이즈 태그(svg·iframe·noscript·media)를 통째 제거', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<svg><path/></svg>' +
      '<iframe></iframe>' +
      '<noscript>no js</noscript>' +
      '<video><source/></video>' +
      '<canvas></canvas>' +
      '<section class="order">본문</section>';
    pruneNoise(root);
    expect(root.querySelector('svg')).toBeNull();
    expect(root.querySelector('iframe')).toBeNull();
    expect(root.querySelector('noscript')).toBeNull();
    expect(root.querySelector('video')).toBeNull();
    expect(root.querySelector('canvas')).toBeNull();
    // 본문은 보존
    expect(root.querySelector('.order')?.textContent).toBe('본문');
  });

  it('HTML 주석 제거', () => {
    const root = document.createElement('div');
    root.innerHTML = '<!-- 추적 코드 --><p>x</p><!-- another -->';
    pruneNoise(root);
    expect(root.innerHTML).not.toContain('추적 코드');
    expect(root.innerHTML).not.toContain('another');
    expect(root.querySelector('p')).not.toBeNull();
  });

  it('공백 전용 텍스트 노드 제거 (들여쓰기·줄바꿈)', () => {
    const root = document.createElement('div');
    root.innerHTML = '\n   <span>a</span>\n   <span>b</span>\n   ';
    pruneNoise(root);
    // 공백 노드가 사라져 자식은 span 2개만
    expect(root.childNodes.length).toBe(2);
  });

  it('sanitizeHTML: <head>(meta·link·title) 통째 제거, body는 보존', () => {
    const html = document.createElement('html');
    html.innerHTML =
      '<head><title>Shop</title><meta charset="utf-8"><link rel="stylesheet" href="x.css"></head>' +
      '<body><section class="order">주문</section></body>';
    const out = sanitizeHTML(html);
    expect(out).not.toContain('<head>');
    expect(out).not.toContain('<title>');
    expect(out).not.toContain('<meta');
    expect(out).not.toContain('<link');
    expect(out).toContain('class="order"');
  });

  it('sanitizeHTML: <script>/<style> 태그는 여전히 남는다 (기존 동작 유지)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<script>var x=1;</script><style>.a{}</style><p>본문</p>';
    const out = sanitizeHTML(root);
    expect(out).toContain('<script>');
    expect(out).toContain('<style>');
  });
});

describe('maskedRatio', () => {
  it('placeholder만 있는 HTML은 높은 비율', () => {
    const html = '<div>[ID_18][CURRENCY_JPY][EMAIL][PHONE]'.repeat(10);
    expect(maskedRatio(html)).toBeGreaterThan(0.3);
  });

  it('평문만 있는 HTML은 낮은 비율 (Worker validateMasking이 reject할 신호)', () => {
    const html =
      '<div>customer@example.com 090-1234-5678 ¥18,500 A10232025092202215</div>'.repeat(20);
    expect(maskedRatio(html)).toBeLessThan(0.3);
  });

  it('빈 HTML도 NaN 아닌 유한값', () => {
    expect(Number.isFinite(maskedRatio(''))).toBe(true);
  });
});
