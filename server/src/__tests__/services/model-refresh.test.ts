import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { refreshFreeModelCatalog, stopModelCatalogRefresher } from '../../services/model-refresh.js';

function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe('Model catalog refresh', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  afterEach(() => {
    stopModelCatalogRefresher();
    vi.restoreAllMocks();
  });

  it('adds OpenRouter :free models to the local fallback chain', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(mockJsonResponse({
      data: [
        { id: 'vendor/new-free-model:free', name: 'New Free Model', context_length: 32768 },
        { id: 'vendor/paid-model', name: 'Paid Model', context_length: 32768 },
      ],
    }));

    const summary = await refreshFreeModelCatalog('manual');

    expect(summary.addedModels).toBe(1);
    const db = getDb();
    const model = db.prepare(`
      SELECT id, display_name, context_window, enabled
      FROM models
      WHERE platform = 'openrouter' AND model_id = 'vendor/new-free-model:free'
    `).get() as { id: number; display_name: string; context_window: number; enabled: number } | undefined;

    expect(model).toMatchObject({
      display_name: 'New Free Model',
      context_window: 32768,
      enabled: 1,
    });
    expect(db.prepare('SELECT 1 FROM fallback_config WHERE model_db_id = ?').get(model!.id)).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM models WHERE platform = 'openrouter' AND model_id = 'vendor/paid-model'").get()).toBeUndefined();
  });

  it('refreshes custom provider models and disables managed models that disappear', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO custom_providers (platform, name, base_url)
      VALUES ('custom:test', 'Test Provider', 'http://127.0.0.1:9000/v1')
    `).run();
    const key = encrypt('custom-secret');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES ('custom:test', 'test', ?, ?, ?, 'healthy', 1)
    `).run(key.encrypted, key.iv, key.authTag);

    vi.spyOn(global, 'fetch').mockImplementation(async url => {
      const href = String(url);
      if (href.includes('openrouter.ai')) {
        return mockJsonResponse({ data: [] });
      }
      return mockJsonResponse({
        data: [{ id: 'local-a', name: 'Local A', context_window: 8192 }],
      });
    });

    const first = await refreshFreeModelCatalog('manual');
    expect(first.sources.some(source => source.platform === 'custom:test' && source.added === 1)).toBe(true);

    const model = db.prepare(`
      SELECT id, enabled
      FROM models
      WHERE platform = 'custom:test' AND model_id = 'local-a'
    `).get() as { id: number; enabled: number };
    expect(model.enabled).toBe(1);

    vi.spyOn(global, 'fetch').mockImplementation(async url => {
      const href = String(url);
      if (href.includes('openrouter.ai')) {
        return mockJsonResponse({ data: [] });
      }
      return mockJsonResponse({ data: [] });
    });

    const second = await refreshFreeModelCatalog('manual');
    expect(second.sources.some(source => source.platform === 'custom:test' && source.disabled === 1)).toBe(true);

    const after = db.prepare('SELECT enabled FROM models WHERE id = ?').get(model.id) as { enabled: number };
    const fallback = db.prepare('SELECT enabled FROM fallback_config WHERE model_db_id = ?').get(model.id) as { enabled: number };
    expect(after.enabled).toBe(0);
    expect(fallback.enabled).toBe(0);
  });
});
