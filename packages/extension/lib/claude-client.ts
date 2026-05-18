import Anthropic from '@anthropic-ai/sdk';
import { getSettings } from './storage';

/**
 * Pro 모드 전용. 사용자 본인 API 키로 직접 Anthropic을 호출한다.
 * 절대 개발자 키나 Worker를 경유하지 않는다 — 메일 본문은 원본 텍스트이기 때문.
 */
export async function callClaude(args: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const { anthropicApiKey, proEnabled } = await getSettings();
  if (!proEnabled) throw new Error('Pro mode is not enabled.');
  if (!anthropicApiKey) throw new Error('Anthropic API key is not set.');

  const client = new Anthropic({
    apiKey: anthropicApiKey,
    dangerouslyAllowBrowser: true,
  });

  const res = await client.messages.create({
    model: args.model ?? 'claude-haiku-4-5',
    max_tokens: args.maxTokens ?? 1024,
    system: args.system,
    messages: [{ role: 'user', content: args.user }],
  });

  const block = res.content[0];
  return block?.type === 'text' ? block.text : '';
}
