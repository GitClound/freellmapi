import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { encrypt, decrypt, maskKey } from '../lib/crypto.js';
import {
  discoverOpenAICompatibleModels,
  normalizeOpenAIBaseUrl,
  type DiscoveredModel,
} from '../services/model-discovery.js';

export const keysRouter = Router();

// Active built-in providers — custom OpenAI-compatible providers are stored as
// `custom:<id>` in custom_providers and resolved dynamically by providers/index.ts.
// Hugging Face, Moonshot, and MiniMax direct integrations were dropped in V4
// (see migrateModelsV4 comment block).
const BUILT_IN_PLATFORMS = [
  'google', 'groq', 'cerebras', 'sambanova', 'nvidia', 'mistral',
  'openrouter', 'github', 'cohere', 'cloudflare', 'zhipu',
] as const;

const builtInKeySchema = z.object({
  platform: z.enum(BUILT_IN_PLATFORMS),
  key: z.string().min(1),
  label: z.string().optional(),
});

const customKeySchema = z.object({
  platform: z.literal('custom'),
  key: z.string().min(1),
  label: z.string().optional(),
  customName: z.string().trim().min(1),
  baseUrl: z.string().trim().url(),
  modelId: z.string().trim().optional(),
  displayName: z.string().trim().optional(),
});

const addKeySchema = z.union([builtInKeySchema, customKeySchema]);

function findOrCreateCustomProvider(name: string, baseUrl: string): string {
  const db = getDb();
  const existing = db.prepare(`
    SELECT platform
    FROM custom_providers
    WHERE lower(name) = lower(?) AND base_url = ?
  `).get(name, baseUrl) as { platform: string } | undefined;

  if (existing) return existing.platform;

  for (let attempt = 0; attempt < 5; attempt++) {
    const platform = `custom:${crypto.randomBytes(6).toString('hex')}`;
    try {
      db.prepare(`
        INSERT INTO custom_providers (platform, name, base_url)
        VALUES (?, ?, ?)
      `).run(platform, name, baseUrl);
      return platform;
    } catch {
      // Retry on the very unlikely random platform collision.
    }
  }

  throw new Error('Failed to create custom provider');
}

function ensureCustomModels(platform: string, providerName: string, models: DiscoveredModel[]) {
  const db = getDb();
  const insertModel = db.prepare(`
    INSERT OR IGNORE INTO models (
      platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
      rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window
    )
    VALUES (?, ?, ?, 50, 20, 'Custom', NULL, NULL, NULL, NULL, 'custom', ?)
  `);
  const selectModel = db.prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?');
  const hasFallback = db.prepare('SELECT 1 FROM fallback_config WHERE model_db_id = ?');
  const addFallback = db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)');
  const maxPriority = db.prepare('SELECT COALESCE(MAX(priority), 0) AS mx FROM fallback_config');

  const apply = db.transaction(() => {
    let nextPriority = ((maxPriority.get() as { mx: number }).mx) + 1;
    for (const model of models) {
      const displayName = model.displayName?.trim() || `${providerName} ${model.id}`;
      insertModel.run(platform, model.id, displayName, model.contextWindow ?? null);
      const row = selectModel.get(platform, model.id) as { id: number } | undefined;
      if (!row) continue;
      if (!hasFallback.get(row.id)) {
        addFallback.run(row.id, nextPriority++);
      }
    }
  });

  apply();
}

// List all keys (masked)
keysRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT ak.*, cp.name as provider_name, cp.base_url as provider_base_url
    FROM api_keys ak
    LEFT JOIN custom_providers cp ON cp.platform = ak.platform
    ORDER BY ak.created_at DESC
  `).all() as any[];

  const keys = rows.map(row => {
    let maskedKey = '****';
    try {
      const realKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
      maskedKey = maskKey(realKey);
    } catch {
      maskedKey = '[decrypt failed]';
    }
    return {
      id: row.id,
      platform: row.platform,
      providerName: row.provider_name ?? undefined,
      providerBaseUrl: row.provider_base_url ?? undefined,
      label: row.label,
      maskedKey,
      status: row.status,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      lastCheckedAt: row.last_checked_at,
    };
  });

  res.json(keys);
});

// List custom providers for the dashboard.
keysRouter.get('/providers', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT platform, name, base_url, created_at
    FROM custom_providers
    ORDER BY created_at DESC
  `).all() as any[];

  res.json(rows.map(row => ({
    platform: row.platform,
    name: row.name,
    baseUrl: row.base_url,
    createdAt: row.created_at,
  })));
});

// Add a key
keysRouter.post('/', async (req: Request, res: Response) => {
  const parsed = addKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  let { platform, key, label } = parsed.data;
  let providerName: string | undefined;
  let providerBaseUrl: string | undefined;
  let importedModels = 0;

  if (parsed.data.platform === 'custom') {
    const name = parsed.data.customName.trim();
    const baseUrl = normalizeOpenAIBaseUrl(parsed.data.baseUrl);
    const explicitModelId = parsed.data.modelId?.trim();
    const discoveredModels = explicitModelId
      ? [{
          id: explicitModelId,
          displayName: parsed.data.displayName?.trim() || explicitModelId,
          contextWindow: null,
        }]
      : await discoverOpenAICompatibleModels(baseUrl, key);

    if (discoveredModels.length === 0) {
      res.status(400).json({
        error: {
          message: 'Could not discover models from the custom provider. Enter a model ID manually, or verify that the URL points to an OpenAI-compatible /v1 base URL.',
        },
      });
      return;
    }

    platform = findOrCreateCustomProvider(name, baseUrl) as any;
    ensureCustomModels(platform, name, discoveredModels);
    providerName = name;
    providerBaseUrl = baseUrl;
    importedModels = discoveredModels.length;
  }

  const { encrypted, iv, authTag } = encrypt(key);

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
    VALUES (?, ?, ?, ?, ?, 'unknown', 1)
  `).run(platform, label ?? '', encrypted, iv, authTag);

  res.status(201).json({
    id: result.lastInsertRowid,
    platform,
    providerName,
    providerBaseUrl,
    importedModels,
    label: label ?? '',
    maskedKey: maskKey(key),
    status: 'unknown',
    enabled: true,
  });
});

// Reveal a saved key on demand. Keys stay encrypted at rest and are only
// decrypted for the local dashboard when the user explicitly asks to show/copy.
keysRouter.get('/:id/reveal', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const db = getDb();
  const row = db.prepare(`
    SELECT ak.*, cp.name as provider_name, cp.base_url as provider_base_url
    FROM api_keys ak
    LEFT JOIN custom_providers cp ON cp.platform = ak.platform
    WHERE ak.id = ?
  `).get(id) as any | undefined;

  if (!row) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  try {
    res.json({
      id: row.id,
      platform: row.platform,
      providerName: row.provider_name ?? undefined,
      providerBaseUrl: row.provider_base_url ?? undefined,
      label: row.label,
      key: decrypt(row.encrypted_key, row.iv, row.auth_tag),
    });
  } catch {
    res.status(500).json({ error: { message: 'Failed to decrypt key' } });
  }
});

// Delete a key
keysRouter.delete('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const db = getDb();
  const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);

  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  res.json({ success: true });
});

// Toggle enable/disable
keysRouter.patch('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: { message: 'enabled must be a boolean' } });
    return;
  }

  const db = getDb();
  const result = db.prepare('UPDATE api_keys SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);

  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  res.json({ success: true, enabled });
});
