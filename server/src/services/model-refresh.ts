import { getDb } from '../db/index.js';
import { decrypt } from '../lib/crypto.js';
import { discoverOpenAICompatibleModels, type DiscoveredModel } from './model-discovery.js';

const DEFAULT_REFRESH_INTERVAL_MINUTES = 6 * 60;
const OPENROUTER_FREE_SOURCE = 'openrouter:free';

type RefreshReason = 'startup' | 'scheduled' | 'manual';
type SourceStatus = 'success' | 'skipped' | 'error';
type RefreshStatus = 'success' | 'partial' | 'error';

interface SourceSummary {
  source: string;
  platform: string;
  status: SourceStatus;
  found: number;
  added: number;
  updated: number;
  disabled: number;
  message?: string;
}

interface ApplyOptions {
  source: string;
  platform: string;
  models: DiscoveredModel[];
  defaults: {
    intelligenceRank: number;
    speedRank: number;
    sizeLabel: string;
    rpmLimit: number | null;
    rpdLimit: number | null;
    tpmLimit: number | null;
    tpdLimit: number | null;
    monthlyTokenBudget: string;
  };
}

export interface ModelCatalogRefreshSummary {
  id: number;
  reason: RefreshReason;
  status: RefreshStatus;
  startedAt: string;
  finishedAt: string;
  addedModels: number;
  updatedModels: number;
  disabledModels: number;
  sources: SourceSummary[];
  error: string | null;
}

let intervalId: ReturnType<typeof setInterval> | null = null;
let startupTimeoutId: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<ModelCatalogRefreshSummary> | null = null;

function getRefreshIntervalMs(): number {
  const raw = process.env.MODEL_REFRESH_INTERVAL_MINUTES;
  const minutes = raw === undefined ? DEFAULT_REFRESH_INTERVAL_MINUTES : Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.floor(minutes * 60 * 1000);
}

function isRefreshEnabled(): boolean {
  return process.env.MODEL_REFRESH_ENABLED !== 'false';
}

function shouldRefreshOnStartup(): boolean {
  return process.env.MODEL_REFRESH_ON_STARTUP !== 'false';
}

function displayNameFromId(modelId: string): string {
  const lastSegment = modelId.split('/').at(-1) ?? modelId;
  return lastSegment
    .replace(/:free$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function applyDiscoveredModels(options: ApplyOptions): Omit<SourceSummary, 'source' | 'platform' | 'status'> {
  const db = getDb();
  const seenIds = new Set(options.models.map(model => model.id));

  const selectModel = db.prepare(`
    SELECT id, display_name, context_window, enabled
    FROM models
    WHERE platform = ? AND model_id = ?
  `);
  const insertModel = db.prepare(`
    INSERT INTO models (
      platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
      rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const updateModel = db.prepare(`
    UPDATE models
       SET display_name = ?,
           context_window = COALESCE(?, context_window),
           enabled = 1
     WHERE id = ?
  `);
  const selectFallback = db.prepare('SELECT enabled FROM fallback_config WHERE model_db_id = ?');
  const insertFallback = db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)');
  const reenableFallback = db.prepare('UPDATE fallback_config SET enabled = 1 WHERE model_db_id = ?');
  const maxPriority = db.prepare('SELECT COALESCE(MAX(priority), 0) AS mx FROM fallback_config');
  const upsertCatalogEntry = db.prepare(`
    INSERT INTO model_catalog_entries (model_db_id, source, last_seen_at, missing_since, disabled_by_refresh)
    VALUES (?, ?, ?, NULL, 0)
    ON CONFLICT(model_db_id) DO UPDATE SET
      source = excluded.source,
      last_seen_at = excluded.last_seen_at,
      missing_since = NULL,
      disabled_by_refresh = 0
  `);
  const selectCatalogEntry = db.prepare('SELECT disabled_by_refresh FROM model_catalog_entries WHERE model_db_id = ?');
  const managedRows = db.prepare(`
    SELECT m.id, m.model_id
    FROM model_catalog_entries ce
    JOIN models m ON m.id = ce.model_db_id
    WHERE ce.source = ? AND m.platform = ?
  `);
  const disableModel = db.prepare('UPDATE models SET enabled = 0 WHERE id = ?');
  const disableFallback = db.prepare('UPDATE fallback_config SET enabled = 0 WHERE model_db_id = ?');
  const markMissing = db.prepare(`
    UPDATE model_catalog_entries
       SET missing_since = COALESCE(missing_since, ?),
           disabled_by_refresh = 1
     WHERE model_db_id = ?
  `);

  let added = 0;
  let updated = 0;
  let disabled = 0;
  let nextPriority = ((maxPriority.get() as { mx: number }).mx) + 1;
  const now = new Date().toISOString();

  const apply = db.transaction(() => {
    for (const model of options.models) {
      const displayName = model.displayName?.trim() || displayNameFromId(model.id);
      const existing = selectModel.get(options.platform, model.id) as {
        id: number;
        display_name: string;
        context_window: number | null;
        enabled: number;
      } | undefined;

      let modelDbId: number;
      let wasDisabledByRefresh = false;

      if (existing) {
        modelDbId = existing.id;
        const catalogEntry = selectCatalogEntry.get(modelDbId) as { disabled_by_refresh: number } | undefined;
        wasDisabledByRefresh = catalogEntry?.disabled_by_refresh === 1;

        const contextChanged = model.contextWindow !== null
          && model.contextWindow !== undefined
          && model.contextWindow !== existing.context_window;
        const displayChanged = displayName !== existing.display_name;
        const enabledChanged = existing.enabled !== 1;

        if (displayChanged || contextChanged || enabledChanged) {
          updateModel.run(displayName, model.contextWindow ?? null, modelDbId);
          updated++;
        }
      } else {
        const inserted = insertModel.run(
          options.platform,
          model.id,
          displayName,
          options.defaults.intelligenceRank,
          options.defaults.speedRank,
          options.defaults.sizeLabel,
          options.defaults.rpmLimit,
          options.defaults.rpdLimit,
          options.defaults.tpmLimit,
          options.defaults.tpdLimit,
          options.defaults.monthlyTokenBudget,
          model.contextWindow ?? null,
        );
        modelDbId = Number(inserted.lastInsertRowid);
        added++;
      }

      const fallback = selectFallback.get(modelDbId) as { enabled: number } | undefined;
      if (!fallback) {
        insertFallback.run(modelDbId, nextPriority++);
      } else if (wasDisabledByRefresh) {
        reenableFallback.run(modelDbId);
      }

      upsertCatalogEntry.run(modelDbId, options.source, now);
    }

    const managed = managedRows.all(options.source, options.platform) as { id: number; model_id: string }[];
    for (const row of managed) {
      if (seenIds.has(row.model_id)) continue;
      disableModel.run(row.id);
      disableFallback.run(row.id);
      markMissing.run(now, row.id);
      disabled++;
    }
  });

  apply();

  return {
    found: options.models.length,
    added,
    updated,
    disabled,
  };
}

async function refreshOpenRouterFreeModels(): Promise<SourceSummary> {
  try {
    const discovered = await discoverOpenAICompatibleModels('https://openrouter.ai/api/v1', undefined, { throwOnError: true });
    const freeModels = discovered.filter(model => model.id.endsWith(':free'));
    const applied = applyDiscoveredModels({
      source: OPENROUTER_FREE_SOURCE,
      platform: 'openrouter',
      models: freeModels,
      defaults: {
        intelligenceRank: 50,
        speedRank: 9,
        sizeLabel: 'Free',
        rpmLimit: 20,
        rpdLimit: 200,
        tpmLimit: null,
        tpdLimit: null,
        monthlyTokenBudget: '~6M',
      },
    });

    return {
      source: OPENROUTER_FREE_SOURCE,
      platform: 'openrouter',
      status: 'success',
      ...applied,
    };
  } catch (err: any) {
    return {
      source: OPENROUTER_FREE_SOURCE,
      platform: 'openrouter',
      status: 'error',
      found: 0,
      added: 0,
      updated: 0,
      disabled: 0,
      message: err?.message ?? 'OpenRouter refresh failed',
    };
  }
}

async function refreshCustomProviders(): Promise<SourceSummary[]> {
  const db = getDb();
  const providers = db.prepare(`
    SELECT cp.platform, cp.name, cp.base_url,
           ak.encrypted_key, ak.iv, ak.auth_tag
    FROM custom_providers cp
    JOIN api_keys ak ON ak.id = (
      SELECT id
      FROM api_keys
      WHERE platform = cp.platform
        AND enabled = 1
        AND status != 'invalid'
      ORDER BY id ASC
      LIMIT 1
    )
    ORDER BY cp.created_at ASC
  `).all() as {
    platform: string;
    name: string;
    base_url: string;
    encrypted_key: string;
    iv: string;
    auth_tag: string;
  }[];

  if (providers.length === 0) {
    return [{
      source: 'custom',
      platform: 'custom',
      status: 'skipped',
      found: 0,
      added: 0,
      updated: 0,
      disabled: 0,
      message: 'No custom providers with enabled keys',
    }];
  }

  const summaries: SourceSummary[] = [];
  for (const provider of providers) {
    const source = `custom:${provider.platform}`;
    try {
      const apiKey = decrypt(provider.encrypted_key, provider.iv, provider.auth_tag);
      const models = await discoverOpenAICompatibleModels(provider.base_url, apiKey, { throwOnError: true });
      const applied = applyDiscoveredModels({
        source,
        platform: provider.platform,
        models,
        defaults: {
          intelligenceRank: 50,
          speedRank: 20,
          sizeLabel: 'Custom',
          rpmLimit: null,
          rpdLimit: null,
          tpmLimit: null,
          tpdLimit: null,
          monthlyTokenBudget: 'custom',
        },
      });

      summaries.push({
        source,
        platform: provider.platform,
        status: 'success',
        ...applied,
      });
    } catch (err: any) {
      summaries.push({
        source,
        platform: provider.platform,
        status: 'error',
        found: 0,
        added: 0,
        updated: 0,
        disabled: 0,
        message: err?.message ?? `Custom provider ${provider.name} refresh failed`,
      });
    }
  }

  return summaries;
}

function insertRefreshRun(reason: RefreshReason, startedAt: string): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO model_refresh_runs (reason, status, started_at, details_json)
    VALUES (?, 'running', ?, '[]')
  `).run(reason, startedAt);
  return Number(result.lastInsertRowid);
}

function finishRefreshRun(summary: ModelCatalogRefreshSummary): void {
  const db = getDb();
  db.prepare(`
    UPDATE model_refresh_runs
       SET status = ?,
           finished_at = ?,
           added_models = ?,
           updated_models = ?,
           disabled_models = ?,
           error = ?,
           details_json = ?
     WHERE id = ?
  `).run(
    summary.status,
    summary.finishedAt,
    summary.addedModels,
    summary.updatedModels,
    summary.disabledModels,
    summary.error,
    JSON.stringify(summary.sources),
    summary.id,
  );
}

async function runRefresh(reason: RefreshReason): Promise<ModelCatalogRefreshSummary> {
  const startedAt = new Date().toISOString();
  const id = insertRefreshRun(reason, startedAt);
  const sources: SourceSummary[] = [];

  try {
    sources.push(await refreshOpenRouterFreeModels());
    sources.push(...await refreshCustomProviders());

    const errors = sources.filter(source => source.status === 'error');
    const summary: ModelCatalogRefreshSummary = {
      id,
      reason,
      status: errors.length > 0 ? 'partial' : 'success',
      startedAt,
      finishedAt: new Date().toISOString(),
      addedModels: sources.reduce((sum, source) => sum + source.added, 0),
      updatedModels: sources.reduce((sum, source) => sum + source.updated, 0),
      disabledModels: sources.reduce((sum, source) => sum + source.disabled, 0),
      sources,
      error: errors.map(source => source.message).filter(Boolean).join('; ') || null,
    };
    finishRefreshRun(summary);
    return summary;
  } catch (err: any) {
    const summary: ModelCatalogRefreshSummary = {
      id,
      reason,
      status: 'error',
      startedAt,
      finishedAt: new Date().toISOString(),
      addedModels: sources.reduce((sum, source) => sum + source.added, 0),
      updatedModels: sources.reduce((sum, source) => sum + source.updated, 0),
      disabledModels: sources.reduce((sum, source) => sum + source.disabled, 0),
      sources,
      error: err?.message ?? 'Model catalog refresh failed',
    };
    finishRefreshRun(summary);
    return summary;
  }
}

export function isModelCatalogRefreshRunning(): boolean {
  return inFlight !== null;
}

export async function refreshFreeModelCatalog(reason: RefreshReason = 'manual'): Promise<ModelCatalogRefreshSummary> {
  if (inFlight) return inFlight;
  inFlight = runRefresh(reason).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function getLastModelCatalogRefresh(): ModelCatalogRefreshSummary | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT *
    FROM model_refresh_runs
    ORDER BY id DESC
    LIMIT 1
  `).get() as {
    id: number;
    reason: RefreshReason;
    status: RefreshStatus;
    started_at: string;
    finished_at: string | null;
    added_models: number;
    updated_models: number;
    disabled_models: number;
    error: string | null;
    details_json: string;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    reason: row.reason,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? row.started_at,
    addedModels: row.added_models,
    updatedModels: row.updated_models,
    disabledModels: row.disabled_models,
    sources: JSON.parse(row.details_json) as SourceSummary[],
    error: row.error,
  };
}

export function startModelCatalogRefresher(): void {
  if (!isRefreshEnabled()) {
    console.log('[ModelRefresh] Disabled by MODEL_REFRESH_ENABLED=false');
    return;
  }
  if (intervalId) return;

  const intervalMs = getRefreshIntervalMs();
  if (intervalMs <= 0) {
    console.log('[ModelRefresh] Disabled by MODEL_REFRESH_INTERVAL_MINUTES<=0');
    return;
  }

  console.log(`[ModelRefresh] Starting catalog refresher (every ${Math.round(intervalMs / 60000)}m)`);

  if (shouldRefreshOnStartup()) {
    startupTimeoutId = setTimeout(() => {
      refreshFreeModelCatalog('startup')
        .then(summary => {
          console.log(
            `[ModelRefresh] Startup refresh ${summary.status}: +${summary.addedModels}, ~${summary.updatedModels}, -${summary.disabledModels}`,
          );
        })
        .catch(err => console.error('[ModelRefresh] Startup refresh failed:', err));
    }, 15000);
    startupTimeoutId.unref?.();
  }

  intervalId = setInterval(() => {
    refreshFreeModelCatalog('scheduled')
      .then(summary => {
        console.log(
          `[ModelRefresh] Scheduled refresh ${summary.status}: +${summary.addedModels}, ~${summary.updatedModels}, -${summary.disabledModels}`,
        );
      })
      .catch(err => console.error('[ModelRefresh] Scheduled refresh failed:', err));
  }, intervalMs);
  intervalId.unref?.();
}

export function stopModelCatalogRefresher(): void {
  if (startupTimeoutId) {
    clearTimeout(startupTimeoutId);
    startupTimeoutId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
