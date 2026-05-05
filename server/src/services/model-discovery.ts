export interface DiscoveredModel {
  id: string;
  displayName?: string;
  contextWindow?: number | null;
}

export function normalizeOpenAIBaseUrl(input: string): string {
  const url = new URL(input.trim());
  url.hash = '';
  url.search = '';

  let pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/chat/completions')) {
    pathname = pathname.slice(0, -'/chat/completions'.length);
  } else if (pathname.endsWith('/models')) {
    pathname = pathname.slice(0, -'/models'.length);
  }

  url.pathname = pathname || '';
  return url.toString().replace(/\/+$/, '');
}

export function parseDiscoveredModels(data: unknown): DiscoveredModel[] {
  const record = data as Record<string, unknown> | null;
  const rawModels = Array.isArray(record?.data)
    ? record.data
    : Array.isArray(record?.models)
      ? record.models
      : Array.isArray(data)
        ? data
        : [];

  return rawModels
    .map((model: unknown): DiscoveredModel | null => {
      if (typeof model === 'string') return { id: model };
      if (!model || typeof model !== 'object') return null;

      const value = model as Record<string, unknown>;
      if (typeof value.id !== 'string' || value.id.trim().length === 0) {
        return null;
      }

      return {
        id: value.id,
        displayName: typeof value.name === 'string' ? value.name : value.id,
        contextWindow:
          typeof value.context_window === 'number' ? value.context_window
            : typeof value.context_length === 'number' ? value.context_length
              : typeof value.contextLength === 'number' ? value.contextLength
                : null,
      };
    })
    .filter((model: DiscoveredModel | null): model is DiscoveredModel => Boolean(model?.id));
}

export async function discoverOpenAICompatibleModels(
  baseUrl: string,
  apiKey?: string,
  options: number | { timeoutMs?: number; throwOnError?: boolean } = 10000,
): Promise<DiscoveredModel[]> {
  const timeoutMs = typeof options === 'number' ? options : options.timeoutMs ?? 10000;
  const throwOnError = typeof options === 'number' ? false : options.throwOnError === true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      if (throwOnError) throw new Error(`Model discovery failed with HTTP ${res.status}`);
      return [];
    }

    const data = await res.json().catch(err => {
      if (throwOnError) throw err;
      return null;
    }) as unknown;
    return parseDiscoveredModels(data).slice(0, 200);
  } catch (err) {
    if (throwOnError) throw err;
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
