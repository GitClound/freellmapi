import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type {
  ChatCompletionResponse,
  ChatMessage,
  ChatToolChoice,
  ChatToolDefinition,
} from '@freellmapi/shared/types.js';
import { getDb } from '../db/index.js';
import { requireUnifiedApiKey } from '../lib/auth.js';
import { routeRequest, recordRateLimitHit, recordSuccess, type RouteResult } from '../services/router.js';
import { recordRequest, recordTokens, setCooldown } from '../services/ratelimit.js';
import type { CompletionOptions } from '../providers/base.js';

export const anthropicRouter = Router();

const MAX_RETRIES = 20;
const DEFAULT_MAX_TOKENS = 1000;

const textBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
}).passthrough();

const toolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown().optional(),
}).passthrough();

const toolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string().min(1),
  content: z.union([z.string(), z.array(z.unknown())]).optional(),
  is_error: z.boolean().optional(),
}).passthrough();

const contentBlockSchema = z.union([
  textBlockSchema,
  toolUseBlockSchema,
  toolResultBlockSchema,
]);

const anthropicMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(contentBlockSchema)]),
}).passthrough();

const anthropicToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  input_schema: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const anthropicToolChoiceSchema = z.object({
  type: z.enum(['auto', 'any', 'tool', 'none']),
  name: z.string().optional(),
}).passthrough();

const anthropicMessagesSchema = z.object({
  model: z.string().optional(),
  max_tokens: z.number().int().positive().optional(),
  messages: z.array(anthropicMessageSchema).min(1),
  system: z.union([z.string(), z.array(textBlockSchema)]).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional(),
  tools: z.array(anthropicToolSchema).optional(),
  tool_choice: anthropicToolChoiceSchema.optional(),
}).passthrough();

type AnthropicRequest = z.infer<typeof anthropicMessagesSchema>;

interface AnthropicContentText {
  type: 'text';
  text: string;
}

interface AnthropicContentToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

type AnthropicContentBlock = AnthropicContentText | AnthropicContentToolUse;

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

class HttpError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code?: string;

  constructor(status: number, message: string, type = 'api_error', code?: string) {
    super(message);
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

anthropicRouter.post('/messages', async (req: Request, res: Response) => {
  const start = Date.now();
  if (!requireUnifiedApiKey(req, res)) return;

  const parsed = anthropicMessagesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
        type: 'invalid_request_error',
      },
    });
    return;
  }

  try {
    const converted = convertAnthropicRequest(parsed.data);
    const execution = await executeCompletion(converted, start);
    const response = toAnthropicResponse(execution.response, execution.route, converted.inputTokens);

    res.setHeader('X-Routed-Via', `${execution.route.platform}/${execution.route.modelId}`);
    if (execution.attempts > 0) res.setHeader('X-Fallback-Attempts', String(execution.attempts));

    if (parsed.data.stream) {
      streamAnthropicResponse(res, response);
      return;
    }

    res.json(response);
  } catch (err: any) {
    const status = err.status ?? 500;
    res.status(status).json({
      error: {
        message: err.message ?? 'Unknown error',
        type: err.type ?? 'api_error',
        ...(err.code ? { code: err.code } : {}),
      },
    });
  }
});

function convertAnthropicRequest(input: AnthropicRequest): {
  requestedModel?: string;
  messages: ChatMessage[];
  options: CompletionOptions;
  inputTokens: number;
} {
  const messages: ChatMessage[] = [];

  const systemText = flattenSystem(input.system);
  if (systemText) messages.push({ role: 'system', content: systemText });

  for (const message of input.messages) {
    if (typeof message.content === 'string') {
      messages.push({ role: message.role, content: message.content });
      continue;
    }

    const textParts: string[] = [];
    const toolCalls: NonNullable<ChatMessage['tool_calls']> = [];
    const toolResults: ChatMessage[] = [];

    for (const block of message.content) {
      if (block.type === 'text') {
        if (block.text) textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
      } else if (block.type === 'tool_result') {
        toolResults.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: flattenToolResult(block.content),
        });
      }
    }

    const text = textParts.join('\n');
    if (message.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else {
      if (text) messages.push({ role: 'user', content: text });
      messages.push(...toolResults);
    }
  }

  const options: CompletionOptions = {
    max_tokens: input.max_tokens,
    temperature: input.temperature,
    top_p: input.top_p,
    tools: input.tools?.map((tool): ChatToolDefinition => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema ?? {},
      },
    })),
    tool_choice: convertToolChoice(input.tool_choice),
  };

  return {
    requestedModel: input.model,
    messages,
    options,
    inputTokens: estimateInputTokens(messages),
  };
}

function flattenSystem(system: AnthropicRequest['system']): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  return system.map(block => block.text).filter(Boolean).join('\n');
}

function flattenToolResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content.map(block => {
    if (typeof block === 'string') return block;
    if (block && typeof block === 'object' && 'text' in block && typeof (block as any).text === 'string') {
      return (block as any).text;
    }
    return JSON.stringify(block);
  }).filter(Boolean).join('\n');
}

function convertToolChoice(choice: AnthropicRequest['tool_choice']): ChatToolChoice | undefined {
  if (!choice) return undefined;
  if (choice.type === 'auto') return 'auto';
  if (choice.type === 'any') return 'required';
  if (choice.type === 'none') return 'none';
  if (choice.type === 'tool' && choice.name) {
    return { type: 'function', function: { name: choice.name } };
  }
  return undefined;
}

async function executeCompletion(
  input: {
    requestedModel?: string;
    messages: ChatMessage[];
    options: CompletionOptions;
    inputTokens: number;
  },
  start: number,
): Promise<{
  response: ChatCompletionResponse;
  route: RouteResult;
  attempts: number;
}> {
  const preferredModel = resolvePreferredModel(input.requestedModel);
  const estimatedTotal = input.inputTokens + (input.options.max_tokens ?? DEFAULT_MAX_TOKENS);
  const skipKeys = new Set<string>();
  let lastError: any = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let route: RouteResult;
    try {
      route = routeRequest(estimatedTotal, skipKeys.size > 0 ? skipKeys : undefined, preferredModel);
    } catch (err: any) {
      if (lastError) {
        throw new HttpError(429, `All models rate-limited. Last error: ${lastError.message}`, 'rate_limit_error');
      }
      throw new HttpError(err.status ?? 503, err.message, 'routing_error');
    }

    recordRequest(route.platform, route.modelId, route.keyId);

    try {
      const response = await route.provider.chatCompletion(
        route.apiKey,
        input.messages,
        route.modelId,
        input.options,
      );

      const totalTokens = response.usage?.total_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      recordTokens(route.platform, route.modelId, route.keyId, totalTokens);
      recordSuccess(route.modelDbId);
      logRequest(
        route.platform,
        route.modelId,
        'success',
        response.usage?.prompt_tokens ?? input.inputTokens,
        outputTokens,
        Date.now() - start,
        null,
      );

      return { response, route, attempts: attempt };
    } catch (err: any) {
      logRequest(route.platform, route.modelId, 'error', input.inputTokens, 0, Date.now() - start, err.message);

      if (isRetryableError(err)) {
        const skipId = `${route.platform}:${route.modelId}:${route.keyId}`;
        skipKeys.add(skipId);
        setCooldown(route.platform, route.modelId, route.keyId, 120_000);
        recordRateLimitHit(route.modelDbId);
        lastError = err;
        continue;
      }

      throw new HttpError(502, `Provider error (${route.displayName}): ${err.message}`, 'provider_error');
    }
  }

  throw new HttpError(429, `All models rate-limited after ${MAX_RETRIES} attempts. Last: ${lastError?.message}`, 'rate_limit_error');
}

function resolvePreferredModel(requestedModel?: string): number | undefined {
  if (isAutoRouteModel(requestedModel)) return undefined;

  const db = getDb();
  const enabled = db.prepare('SELECT id FROM models WHERE model_id = ? AND enabled = 1').get(requestedModel) as { id: number } | undefined;
  if (enabled) return enabled.id;

  const disabled = db.prepare('SELECT id FROM models WHERE model_id = ?').get(requestedModel) as { id: number } | undefined;
  const reason = disabled ? 'is disabled' : 'is not in the catalog';
  throw new HttpError(
    400,
    `Model '${requestedModel}' ${reason}. Use 'auto' to let FreeLLMAPI route the request.`,
    'invalid_request_error',
    'model_not_found',
  );
}

function isAutoRouteModel(model?: string): boolean {
  if (!model) return true;
  const normalized = model.trim().toLowerCase();
  return normalized === 'auto'
    || normalized === 'default'
    || normalized === 'freellmapi-auto'
    || normalized === 'sonnet'
    || normalized === 'opus'
    || normalized === 'haiku'
    || normalized === 'opusplan'
    || normalized.startsWith('claude-');
}

function estimateInputTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => {
    if (typeof message.content !== 'string') return sum;
    return sum + Math.ceil(message.content.length / 4);
  }, 0);
}

function toAnthropicResponse(
  response: ChatCompletionResponse,
  route: RouteResult,
  fallbackInputTokens: number,
): AnthropicResponse {
  const choice = response.choices[0];
  const message = choice?.message;
  const content = message ? toAnthropicContent(message) : [{ type: 'text' as const, text: '' }];

  return {
    id: response.id?.startsWith('msg_') ? response.id : `msg_${response.id ?? Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: route.modelId,
    content,
    stop_reason: mapStopReason(choice?.finish_reason ?? null),
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? fallbackInputTokens,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

function toAnthropicContent(message: ChatMessage): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  if (typeof message.content === 'string' && message.content.length > 0) {
    blocks.push({ type: 'text', text: message.content });
  }

  for (const toolCall of message.tool_calls ?? []) {
    blocks.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function.name,
      input: parseToolInput(toolCall.function.arguments),
    });
  }

  return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }];
}

function parseToolInput(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw_arguments: raw };
  }
}

function mapStopReason(finishReason: string | null): AnthropicResponse['stop_reason'] {
  if (finishReason === 'tool_calls') return 'tool_use';
  if (finishReason === 'length') return 'max_tokens';
  if (finishReason === 'content_filter') return 'stop_sequence';
  return 'end_turn';
}

function streamAnthropicResponse(res: Response, response: AnthropicResponse): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  writeEvent(res, 'message_start', {
    type: 'message_start',
    message: {
      ...response,
      content: [],
      stop_reason: null,
      usage: { input_tokens: response.usage.input_tokens, output_tokens: 0 },
    },
  });

  response.content.forEach((block, index) => {
    if (block.type === 'text') {
      writeEvent(res, 'content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      if (block.text) {
        writeEvent(res, 'content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text: block.text },
        });
      }
    } else {
      writeEvent(res, 'content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      });
      writeEvent(res, 'content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) },
      });
    }

    writeEvent(res, 'content_block_stop', {
      type: 'content_block_stop',
      index,
    });
  });

  writeEvent(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: response.stop_reason, stop_sequence: null },
    usage: { output_tokens: response.usage.output_tokens },
  });
  writeEvent(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

function writeEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function isRetryableError(err: any): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')
    || msg.includes('quota') || msg.includes('resource_exhausted')
    || msg.includes('aborted') || msg.includes('timeout') || msg.includes('etimedout')
    || msg.includes('econnrefused') || msg.includes('econnreset')
    || msg.includes('503') || msg.includes('unavailable')
    || msg.includes('500') || msg.includes('internal server error');
}

function logRequest(
  platform: string,
  modelId: string,
  status: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  error: string | null,
) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(platform, modelId, status, inputTokens, outputTokens, latencyMs, error);
  } catch (e) {
    console.error('Failed to log request:', e);
  }
}
