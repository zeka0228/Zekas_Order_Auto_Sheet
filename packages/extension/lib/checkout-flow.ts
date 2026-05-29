/**
 * 결제 캡처 content script의 순수 판정 로직 (DOM·chrome API 없이 단위 테스트 가능).
 *
 * 1차 게이트(결제 흐름 페이지인가)·장바구니 식별·빈 카트 판별을 제공한다.
 * (완료 페이지 역할 판정 `decidePageRole`은 §1.9로 폐기 — 완료 페이지 캡처를 더는 안 함.)
 */

/**
 * AI/네트워크 호출 전 값싼 1차 게이트 — 결제 흐름 페이지일 법한가.
 *
 * 다국어 키워드:
 *   - 영어: 일반 + cart 변형(basket/bag/trolley/shoppingcart)
 *   - 일본어: 注文·決済·購入·カート
 *   - 중국어 간체: 购物车·结算·订单·支付·完成·成功·确认
 *   - 중국어 번체: 購物車·結算·訂單·確認
 *   - 한국어: 자국이라 직구 대상 아님이지만 키워드 잡혀도 isDomesticSite가 차단
 */
export function looksLikeCheckoutOrCompletion(doc: Document, url: string): boolean {
  const u = url.toLowerCase();
  if (
    /(cart|basket|bag|trolley|shoppingcart|shopping[-_]cart|checkout|order|payment|pay|thank|complete|success|receipt|confirm|注文|決済|購入|カート|购物车|结算|订单|支付|完成|成功|确认|購物車|結算|訂單|確認|주문|결제|구매|장바구니)/.test(
      u,
    )
  ) {
    return true;
  }
  const text = doc.body?.innerText ?? '';
  return /(order\s*number|order\s*id|주문번호|注文番号|订单号|訂單號|お支払い|ご注文|決済|결제완료|주문완료|您的订单|感谢您的购买|您的訂單|訂單成功|订单已确认)/i.test(
    text,
  );
}

/**
 * URL이 장바구니 페이지인지. 누적 캡처 대상 식별용.
 *
 * 표준화된 path 키워드가 대부분의 쇼핑몰을 커버한다:
 *   - Shopify·WooCommerce·BigCommerce·Squarespace 등 SaaS 플랫폼이 /cart 표준
 *   - 변형: /basket(영국)·/bag(패션)·/trolley(영국 슈퍼)·/shopping-cart
 *   - 자국어 path는 드묾(/カート·/购物车·/장바구니)이지만 대비
 *
 * 잡지 못하는 케이스: SPA 미니카트(URL 무변경), AJAX 드롭다운 — 이건 별도 신호 필요.
 */
export function isCartPage(url: string): boolean {
  const u = url.toLowerCase();
  return /(\/|=|\?)(cart|basket|bag|trolley|shoppingcart|shopping[-_]cart|minicart|カート|购物车|購物車|장바구니)(?:\/|$|\?|#|&|\b)/.test(
    u,
  );
}

/**
 * 본문에 가격(통화기호+숫자) 패턴이 하나라도 있는가 — 빈 장바구니 판별용.
 *
 * 캐시된 셀렉터가 장바구니에서 상품명·가격을 못 잡았을 때, 그게 "셀렉터 stale"인지
 * "빈 장바구니"인지 구분하기 위함. 빈 장바구니면 자가 치유를 발동시키지 않는다 —
 * 사이트 구조가 바뀐 게 아니라 그냥 사용자가 아직 안 담은 것.
 */
export function hasCartPriceSignal(doc: Document): boolean {
  const text = doc.body?.innerText ?? doc.body?.textContent ?? '';
  // 통화기호 + 숫자, 또는 숫자 + 통화 접미사. CJK 통화 단위도 포함.
  return /[¥$€₩£]\s*\d|\d+(?:[,.]\d+)*\s*(?:원|円|元)/.test(text);
}
