import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';

async function request(app: Express, method: string, path: string, body?: any) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data };
}

describe('Keys API', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM api_keys').run();
    db.prepare("DELETE FROM fallback_config WHERE model_db_id IN (SELECT id FROM models WHERE platform LIKE 'custom:%')").run();
    db.prepare("DELETE FROM models WHERE platform LIKE 'custom:%'").run();
    db.prepare('DELETE FROM custom_providers').run();
  });

  it('GET /api/keys returns empty array initially', async () => {
    const { status, body } = await request(app, 'GET', '/api/keys');
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it('POST /api/keys creates a new key', async () => {
    const { status, body } = await request(app, 'POST', '/api/keys', {
      platform: 'groq',
      key: 'gsk_test123456789',
      label: 'My Groq Key',
    });

    expect(status).toBe(201);
    expect(body.platform).toBe('groq');
    expect(body.label).toBe('My Groq Key');
    expect(body.maskedKey).toContain('...');
  });

  it('GET /api/keys returns the created key', async () => {
    // First create a key
    await request(app, 'POST', '/api/keys', {
      platform: 'groq',
      key: 'gsk_test123456789',
    });

    const { status, body } = await request(app, 'GET', '/api/keys');
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].platform).toBe('groq');
  });

  it('GET /api/keys/:id/reveal returns the saved key', async () => {
    const { body: created } = await request(app, 'POST', '/api/keys', {
      platform: 'groq',
      key: 'gsk_test123456789',
      label: 'My Groq Key',
    });

    const { status, body } = await request(app, 'GET', `/api/keys/${created.id}/reveal`);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: created.id,
      platform: 'groq',
      label: 'My Groq Key',
      key: 'gsk_test123456789',
    });
  });

  it('GET /api/keys/:id/reveal returns 404 for nonexistent key', async () => {
    const { status } = await request(app, 'GET', '/api/keys/99999/reveal');
    expect(status).toBe(404);
  });

  it('POST /api/keys rejects invalid platform', async () => {
    const { status } = await request(app, 'POST', '/api/keys', {
      platform: 'invalid_platform',
      key: 'test',
    });
    expect(status).toBe(400);
  });

  it('POST /api/keys rejects missing key', async () => {
    const { status } = await request(app, 'POST', '/api/keys', {
      platform: 'groq',
    });
    expect(status).toBe(400);
  });

  it('POST /api/keys creates a custom provider key and fallback model', async () => {
    const { status, body } = await request(app, 'POST', '/api/keys', {
      platform: 'custom',
      customName: 'Local vLLM',
      baseUrl: 'http://127.0.0.1:8000/v1',
      modelId: 'local-model',
      key: 'local-secret',
      label: 'local',
    });

    expect(status).toBe(201);
    expect(body.platform).toMatch(/^custom:/);
    expect(body.providerName).toBe('Local vLLM');
    expect(body.providerBaseUrl).toBe('http://127.0.0.1:8000/v1');
    expect(body.importedModels).toBe(1);

    const db = getDb();
    const model = db.prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?')
      .get(body.platform, 'local-model') as { id: number } | undefined;
    expect(model).toBeTruthy();

    const fallback = db.prepare('SELECT 1 FROM fallback_config WHERE model_db_id = ?').get(model!.id);
    expect(fallback).toBeTruthy();
  });

  it('DELETE /api/keys/:id removes a key', async () => {
    const { body: created } = await request(app, 'POST', '/api/keys', {
      platform: 'groq',
      key: 'gsk_test123456789',
    });

    const { status } = await request(app, 'DELETE', `/api/keys/${created.id}`);
    expect(status).toBe(200);

    const { body: after } = await request(app, 'GET', '/api/keys');
    expect(after).toHaveLength(0);
  });

  it('DELETE /api/keys/:id returns 404 for nonexistent key', async () => {
    const { status } = await request(app, 'DELETE', '/api/keys/99999');
    expect(status).toBe(404);
  });
});
