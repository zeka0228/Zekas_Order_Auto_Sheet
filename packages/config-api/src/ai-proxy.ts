import type { Env } from './env';

const PROMPTS: Record<'shop' | 'baedaeji', string> = {
  shop: `당신은 웹 페이지의 HTML 구조로부터 CSS 셀렉터를 추출하는 도우미입니다.
입력 HTML은 모든 텍스트가 [TYPE_…] 형태의 placeholder로 치환된 마스킹된 결제 완료 페이지입니다.
주문번호, 상품명, 가격 같은 핵심 필드를 가리키는 안정적인 CSS 셀렉터를 JSON 객체로 반환하세요.

반드시 다음 형태의 JSON만 출력 (코드 펜스 금지):
{"orderNumber":"...", "productName":"...", "price":"...", "currency":"..."}

값이 보이지 않으면 키 자체를 생략. data-* 또는 의미 있는 class 선호. nth-child 같은 깨지기 쉬운 셀렉터는 피하세요.`,
  baedaeji: `당신은 한국 배송대행지(배대지) 주문서 폼의 입력 필드를 매핑하는 도우미입니다.
입력 HTML은 마스킹된 주문서 페이지입니다. 다음 필드의 input/select/textarea 셀렉터를 JSON 객체로 반환하세요:
trackingNumber, productName, declaredPrice, currency, quantity, productCategory.

반드시 JSON만 출력 (코드 펜스 금지). 보이지 않는 필드는 키 자체를 생략.`,
};

export async function generateSelectorsWithAI(
  env: Env,
  type: 'shop' | 'baedaeji',
  sanitizedHtml: string,
): Promise<Record<string, string> | null> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      system: PROMPTS[type],
      messages: [{ role: 'user', content: sanitizedHtml }],
    }),
  });
  if (!res.ok) {
    console.error('[ZOAS] Anthropic error:', res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const block = data.content?.find((b) => b.type === 'text');
  if (!block?.text) return null;
  try {
    const parsed = JSON.parse(block.text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v.length < 500) cleaned[k] = v;
      }
      return cleaned;
    }
    return null;
  } catch {
    return null;
  }
}
