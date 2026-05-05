import type { Platform } from '@freellmapi/shared/types.js';
import type { BaseProvider } from './base.js';
import { GoogleProvider } from './google.js';
import { OpenAICompatProvider } from './openai-compat.js';
import { CohereProvider } from './cohere.js';
import { CloudflareProvider } from './cloudflare.js';
import { getDb } from '../db/index.js';

const providers = new Map<Platform, BaseProvider>();
const customProviderCache = new Map<string, { name: string; baseUrl: string; provider: BaseProvider }>();
const localProxyOrigin = `http://localhost:${process.env.PORT ?? 13002}`;

function register(provider: BaseProvider) {
  providers.set(provider.platform, provider);
}

// Google - unique Gemini API format
register(new GoogleProvider());

// Groq - OpenAI-compatible
register(new OpenAICompatProvider({
  platform: 'groq',
  name: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
}));

// Cerebras - OpenAI-compatible
register(new OpenAICompatProvider({
  platform: 'cerebras',
  name: 'Cerebras',
  baseUrl: 'https://api.cerebras.ai/v1',
}));

// SambaNova - OpenAI-compatible
register(new OpenAICompatProvider({
  platform: 'sambanova',
  name: 'SambaNova',
  baseUrl: 'https://api.sambanova.ai/v1',
}));

// NVIDIA NIM - OpenAI-compatible
register(new OpenAICompatProvider({
  platform: 'nvidia',
  name: 'NVIDIA NIM',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
}));

// Mistral - OpenAI-compatible
register(new OpenAICompatProvider({
  platform: 'mistral',
  name: 'Mistral',
  baseUrl: 'https://api.mistral.ai/v1',
}));

// OpenRouter - OpenAI-compatible with extra headers
register(new OpenAICompatProvider({
  platform: 'openrouter',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  extraHeaders: {
    'HTTP-Referer': localProxyOrigin,
    'X-Title': 'FreeLLMAPI',
  },
}));

// GitHub Models — OpenAI-compatible. Catalog uses `<publisher>/<model>` ids
// (e.g. `openai/gpt-4.1`); the old Azure endpoint rejects that prefix with
// "Unknown model", so route to the current models.github.ai endpoint.
register(new OpenAICompatProvider({
  platform: 'github',
  name: 'GitHub Models',
  baseUrl: 'https://models.github.ai/inference',
}));

// Cohere - OpenAI-compatible via Cohere compatibility endpoint
register(new CohereProvider());

// Cloudflare Workers AI - OpenAI-compatible endpoint (key = "account_id:token")
register(new CloudflareProvider());

// Zhipu (Z.ai / bigmodel.cn) - OpenAI-compatible
register(new OpenAICompatProvider({
  platform: 'zhipu',
  name: 'Zhipu AI',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
}));

// Hugging Face, Moonshot, MiniMax direct integrations were dropped in V4 —
// HF tool-call format issues; Moonshot moved to paid; MiniMax superseded by
// the OpenRouter route (openrouter/minimax/minimax-m2.5:free).

function getCustomProvider(platform: string): BaseProvider | undefined {
  if (!platform.startsWith('custom:')) return undefined;

  const row = getDb().prepare(`
    SELECT name, base_url
    FROM custom_providers
    WHERE platform = ?
  `).get(platform) as { name: string; base_url: string } | undefined;

  if (!row) return undefined;

  const cached = customProviderCache.get(platform);
  if (cached && cached.name === row.name && cached.baseUrl === row.base_url) {
    return cached.provider;
  }

  const provider = new OpenAICompatProvider({
    platform: platform as Platform,
    name: row.name,
    baseUrl: row.base_url,
    timeoutMs: 30000,
  });
  customProviderCache.set(platform, { name: row.name, baseUrl: row.base_url, provider });
  return provider;
}

export function getProvider(platform: Platform | string): BaseProvider | undefined {
  return providers.get(platform as Platform) ?? getCustomProvider(platform);
}

export function getAllProviders(): BaseProvider[] {
  return Array.from(providers.values());
}

export function hasProvider(platform: Platform | string): boolean {
  if (providers.has(platform as Platform)) return true;
  if (!platform.startsWith('custom:')) return false;

  const row = getDb().prepare('SELECT 1 FROM custom_providers WHERE platform = ?').get(platform);
  return Boolean(row);
}
