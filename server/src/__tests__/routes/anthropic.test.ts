import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
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

  const raw = await res.text();
  server.close();

  let json: any = null;
  try { json = JSON.parse(raw); } catch {}

  return { status: res.status, body: json, headers: res.headers, raw };
}

describe('Anthropic-compatible proxy', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
  });

  beforeEach(async () => {
    const db = getDb();
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM requests').run();

    const addKey = await request(app, 'POST', '/api/keys', {
      platform: 'groq',
      key: 'gsk_anthropic_test',
      label: 'anthropic',
    });
    expect(addKey.status).toBe(201);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('translates /v1/messages into an OpenAI-compatible chat request', async () => {
    const origFetch = global.fetch;
    let providerBody: any = null;

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('api.groq.com/openai/v1/chat/completions')) {
        providerBody = JSON.parse((init as any).body);
        return {
          ok: true,
          json: () => Promise.resolve({
            id: 'chatcmpl-anthropic',
            object: 'chat.completion',
            created: 123,
            model: providerBody.model,
            choices: [{
              index: 0,
              message: { role: 'assistant', content: 'Hello from FreeLLMAPI.' },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 },
          }),
        } as any;
      }
      return origFetch(url, init);
    });

    const { status, body } = await request(app, 'POST', '/v1/messages', {
      model: 'auto',
      max_tokens: 128,
      system: 'Be concise.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });

    expect(status).toBe(200);
    expect(providerBody.max_tokens).toBe(128);
    expect(providerBody.messages).toEqual([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'hello' },
    ]);
    expect(body.type).toBe('message');
    expect(body.role).toBe('assistant');
    expect(body.content[0]).toEqual({ type: 'text', text: 'Hello from FreeLLMAPI.' });
    expect(body.usage).toEqual({ input_tokens: 9, output_tokens: 5 });
  });

  it('treats Claude Code model aliases as fallback-chain routing', async () => {
    const origFetch = global.fetch;
    let providerBody: any = null;

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('api.groq.com/openai/v1/chat/completions')) {
        providerBody = JSON.parse((init as any).body);
        return {
          ok: true,
          json: () => Promise.resolve({
            id: 'chatcmpl-sonnet',
            object: 'chat.completion',
            created: 123,
            model: providerBody.model,
            choices: [{
              index: 0,
              message: { role: 'assistant', content: 'Routed through FreeLLMAPI.' },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
          }),
        } as any;
      }
      return origFetch(url, init);
    });

    const { status, body } = await request(app, 'POST', '/v1/messages', {
      model: 'sonnet',
      max_tokens: 128,
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(status).toBe(200);
    expect(providerBody.model).toBeTruthy();
    expect(providerBody.model).not.toBe('sonnet');
    expect(body.model).toBe(providerBody.model);
  });

  it('translates Anthropic tool definitions and tool_use responses', async () => {
    const origFetch = global.fetch;
    let providerBody: any = null;

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('api.groq.com/openai/v1/chat/completions')) {
        providerBody = JSON.parse((init as any).body);
        return {
          ok: true,
          json: () => Promise.resolve({
            id: 'chatcmpl-tool-use',
            object: 'chat.completion',
            created: 123,
            model: providerBody.model,
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                  id: 'call_weather',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"city":"Karachi"}',
                  },
                }],
              },
              finish_reason: 'tool_calls',
            }],
            usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
          }),
        } as any;
      }
      return origFetch(url, init);
    });

    const { status, body } = await request(app, 'POST', '/v1/messages', {
      model: 'auto',
      max_tokens: 128,
      messages: [{ role: 'user', content: 'weather?' }],
      tools: [{
        name: 'get_weather',
        description: 'Get current weather',
        input_schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      }],
      tool_choice: { type: 'tool', name: 'get_weather' },
    });

    expect(status).toBe(200);
    expect(providerBody.tools[0].function.name).toBe('get_weather');
    expect(providerBody.tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } });
    expect(body.stop_reason).toBe('tool_use');
    expect(body.content[0]).toEqual({
      type: 'tool_use',
      id: 'call_weather',
      name: 'get_weather',
      input: { city: 'Karachi' },
    });
  });

  it('synthesizes Anthropic SSE events when stream is true', async () => {
    const origFetch = global.fetch;

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('api.groq.com/openai/v1/chat/completions')) {
        const providerBody = JSON.parse((init as any).body);
        return {
          ok: true,
          json: () => Promise.resolve({
            id: 'chatcmpl-stream',
            object: 'chat.completion',
            created: 123,
            model: providerBody.model,
            choices: [{
              index: 0,
              message: { role: 'assistant', content: 'streamed answer' },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 },
          }),
        } as any;
      }
      return origFetch(url, init);
    });

    const { status, headers, raw } = await request(app, 'POST', '/v1/messages', {
      model: 'auto',
      max_tokens: 128,
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(status).toBe(200);
    expect(headers.get('content-type')).toContain('text/event-stream');
    expect(raw).toContain('event: message_start');
    expect(raw).toContain('event: content_block_delta');
    expect(raw).toContain('streamed answer');
    expect(raw).toContain('event: message_stop');
  });
});
