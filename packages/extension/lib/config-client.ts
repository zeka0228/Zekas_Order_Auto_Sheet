import { SiteConfigSchema, type SiteConfig } from './schemas';
import { getSettings } from './storage';

const DEFAULT_BASE = 'https://zoas-worker.jhim0228.workers.dev'; // Phase 0 배포 URL (2026-05-21)

async function baseUrl(): Promise<string> {
  return (await getSettings()).workerBaseUrl ?? DEFAULT_BASE;
}

async function anonId(): Promise<string> {
  const key = 'anon_id';
  const got = await chrome.storage.local.get(key);
  if (typeof got[key] === 'string') return got[key];
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [key]: id });
  return id;
}

async function headers(): Promise<HeadersInit> {
  return {
    'Content-Type': 'application/json',
    'X-Anon-Id': await anonId(),
  };
}

export async function getCachedConfig(
  domain: string,
  type: 'shop' | 'baedaeji',
): Promise<SiteConfig | null> {
  const url = `${await baseUrl()}/configs?type=${type}&domain=${encodeURIComponent(domain)}`;
  const res = await fetch(url, { headers: await headers() });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const parsed = SiteConfigSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export async function generateConfig(
  domain: string,
  type: 'shop' | 'baedaeji',
  sanitizedHtml: string,
): Promise<SiteConfig | null> {
  const res = await fetch(`${await baseUrl()}/generate-config`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({ domain, type, sanitized_html: sanitizedHtml }),
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const parsed = SiteConfigSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export async function reportSuccess(configId: number): Promise<void> {
  await fetch(`${await baseUrl()}/feedback`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({ config_id: configId, outcome: 'success' }),
  }).catch(() => undefined);
}

export async function reportFailure(configId: number): Promise<void> {
  await fetch(`${await baseUrl()}/feedback`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({ config_id: configId, outcome: 'failure' }),
  }).catch(() => undefined);
}
