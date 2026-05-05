import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, ExternalLink } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { PageHeader } from '@/components/page-header'
import { useI18n } from '@/lib/i18n'
import type { ApiKey, ApiKeyReveal, BuiltInPlatform, Platform } from '../../../shared/types'

type ProviderFormPlatform = BuiltInPlatform | 'custom'

const PLATFORMS: { value: BuiltInPlatform; label: string }[] = [
  { value: 'google', label: 'Google AI Studio' },
  { value: 'groq', label: 'Groq' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'sambanova', label: 'SambaNova' },
  { value: 'nvidia', label: 'NVIDIA NIM' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'github', label: 'GitHub Models' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI' },
  { value: 'zhipu', label: 'Zhipu AI (Z.ai)' },
]

const statusDot: Record<string, string> = {
  healthy: 'bg-emerald-500',
  rate_limited: 'bg-amber-500',
  invalid: 'bg-rose-500',
  error: 'bg-rose-500',
  unknown: 'bg-muted-foreground/40',
}

interface HealthPlatform {
  platform: string
  totalKeys: number
  healthyKeys: number
  rateLimitedKeys: number
  invalidKeys: number
  errorKeys: number
  unknownKeys: number
}

interface HealthData {
  platforms: HealthPlatform[]
  keys: { id: number; platform: string; status: string; lastCheckedAt: string | null }[]
}

function normalizeLoopbackHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host === '::1' || host === '0.0.0.0') {
    return '127.0.0.1'
  }
  return host
}

function formatHostForUrl(hostname: string) {
  const host = normalizeLoopbackHost(hostname)
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

function getProxyBaseUrl() {
  const host = formatHostForUrl(window.location.hostname)
  if (import.meta.env.DEV) return `http://${host}:${__SERVER_PORT__}/v1`

  const port = window.location.port ? `:${window.location.port}` : ''
  return `${window.location.protocol}//${host}${port}/v1`
}

function getProxyOriginUrl() {
  const host = formatHostForUrl(window.location.hostname)
  if (import.meta.env.DEV) return `http://${host}:${__SERVER_PORT__}`

  const port = window.location.port ? `:${window.location.port}` : ''
  return `${window.location.protocol}//${host}${port}`
}

function getDashboardHomepageUrl() {
  const host = formatHostForUrl(window.location.hostname)
  const port = window.location.port ? `:${window.location.port}` : ''
  return `${window.location.protocol}//${host}${port}/`
}

function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function createCcSwitchLink(app: 'claude' | 'codex', name: string, config: object, homepage: string) {
  const params = new URLSearchParams({
    resource: 'provider',
    app,
    name,
    homepage,
    enabled: 'true',
    configFormat: 'json',
    config: encodeBase64Utf8(JSON.stringify(config)),
  })

  return `ccswitch://v1/import?${params.toString()}`
}

function createCodexToml(baseUrl: string) {
  return [
    'model_provider = "freellmapi"',
    'model = "auto"',
    'model_reasoning_effort = "medium"',
    'disable_response_storage = true',
    '',
    '[model_providers.freellmapi]',
    'name = "FreeLLMAPI"',
    `base_url = "${baseUrl}"`,
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "chat"',
  ].join('\n')
}

function UnifiedKeySection() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const { data } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })

  const regenerate = useMutation({
    mutationFn: () => apiFetch('/api/settings/api-key/regenerate', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['unified-key'] }),
  })

  const apiKey = data?.apiKey ?? ''
  const masked = apiKey ? apiKey.slice(0, 13) + '•'.repeat(32) : '…'
  const baseUrl = getProxyBaseUrl()

  function copy() {
    navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-sm font-medium">{t('keys.unifiedTitle')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('keys.unifiedDescription')}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending}
        >
          {t('keys.regenerate')}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-xs bg-muted px-3 py-2 rounded-md select-all truncate tabular-nums">
          {showKey ? apiKey : masked}
        </code>
        <Button variant="outline" size="sm" onClick={() => setShowKey(!showKey)}>
          {showKey ? t('keys.hide') : t('keys.show')}
        </Button>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? t('keys.copied') : t('keys.copy')}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">{t('keys.baseUrl')}</span>
        <code className="font-mono">{baseUrl}</code>
        <span className="text-muted-foreground">{t('keys.endpoint')}</span>
        <code className="font-mono">/v1/chat/completions</code>
      </div>
    </section>
  )
}

function CcSwitchImportSection() {
  const { t } = useI18n()
  const { data } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })
  const [copiedTarget, setCopiedTarget] = useState<'claude' | 'codex' | null>(null)

  const apiKey = data?.apiKey ?? ''
  const baseUrl = getProxyBaseUrl()
  const anthropicBaseUrl = getProxyOriginUrl()
  const homepageUrl = getDashboardHomepageUrl()
  const claudeLink = createCcSwitchLink('claude', 'FreeLLMAPI', {
    env: {
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_BASE_URL: anthropicBaseUrl,
      ANTHROPIC_MODEL: 'auto',
      ANTHROPIC_CUSTOM_MODEL_OPTION: 'auto',
      ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: 'FreeLLMAPI Auto',
      ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION: 'Routes through the FreeLLMAPI fallback chain.',
    },
  }, homepageUrl)
  const codexLink = createCcSwitchLink('codex', 'FreeLLMAPI', {
    auth: {
      OPENAI_API_KEY: apiKey,
    },
    config: createCodexToml(baseUrl),
  }, homepageUrl)

  async function copyLink(target: 'claude' | 'codex', link: string) {
    await navigator.clipboard.writeText(link)
    setCopiedTarget(target)
    setTimeout(() => setCopiedTarget(null), 1500)
  }

  const options = [
    {
      id: 'claude' as const,
      title: t('keys.ccswitch.claudeTitle'),
      description: t('keys.ccswitch.claudeDescription'),
      link: claudeLink,
    },
    {
      id: 'codex' as const,
      title: t('keys.ccswitch.codexTitle'),
      description: t('keys.ccswitch.codexDescription'),
      link: codexLink,
    },
  ]

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-medium">{t('keys.ccswitch.title')}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t('keys.ccswitch.description')}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {options.map(option => (
          <div key={option.id} className="rounded-md border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">{option.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  {option.description}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={() => { window.location.href = option.link }} disabled={!apiKey}>
                <ExternalLink />
                {t('keys.ccswitch.import')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyLink(option.id, option.link)}
                disabled={!apiKey}
              >
                <Copy />
                {copiedTarget === option.id ? t('keys.copied') : t('keys.copy')}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">{t('keys.baseUrl')}</span>
        <code className="font-mono break-all">{baseUrl}</code>
        <span className="text-muted-foreground">{t('keys.ccswitch.model')}</span>
        <code className="font-mono">auto</code>
      </div>
    </section>
  )
}

export default function KeysPage() {
  const { t, language } = useI18n()
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState<ProviderFormPlatform | ''>('')
  const [apiKey, setApiKey] = useState('')
  const [accountId, setAccountId] = useState('')
  const [customName, setCustomName] = useState('')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customModelId, setCustomModelId] = useState('')
  const [label, setLabel] = useState('')
  const [revealedKeys, setRevealedKeys] = useState<Record<number, string>>({})
  const [revealingKeyId, setRevealingKeyId] = useState<number | null>(null)
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null)
  const [checkingKeyIds, setCheckingKeyIds] = useState<Set<number>>(() => new Set())
  const [checkingPlatforms, setCheckingPlatforms] = useState<Set<Platform>>(() => new Set())

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ['keys'],
    queryFn: () => apiFetch('/api/keys'),
  })

  const { data: healthData } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health'),
    refetchInterval: 30000,
  })

  const addKey = useMutation({
    mutationFn: (body: {
      platform: string
      key: string
      label?: string
      customName?: string
      baseUrl?: string
      modelId?: string
    }) =>
      apiFetch('/api/keys', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setPlatform('')
      setApiKey('')
      setAccountId('')
      setCustomName('')
      setCustomBaseUrl('')
      setCustomModelId('')
      setLabel('')
    },
  })

  const deleteKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/keys/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      setRevealedKeys(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    },
  })

  const checkAll = useMutation({
    mutationFn: () => apiFetch('/api/health/check-all', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const checkKey = useMutation({
    mutationFn: (keyId: number) => apiFetch(`/api/health/check/${keyId}`, { method: 'POST' }),
    onMutate: (keyId) => {
      setCheckingKeyIds(prev => {
        const next = new Set(prev)
        next.add(keyId)
        return next
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
    onSettled: (_data, _error, keyId) => {
      setCheckingKeyIds(prev => {
        const next = new Set(prev)
        next.delete(keyId)
        return next
      })
    },
  })

  const checkPlatform = useMutation({
    mutationFn: (platform: Platform) =>
      apiFetch(`/api/health/check-platform/${encodeURIComponent(platform)}`, { method: 'POST' }),
    onMutate: (platform) => {
      setCheckingPlatforms(prev => {
        const next = new Set(prev)
        next.add(platform)
        return next
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
    onSettled: (_data, _error, platform) => {
      setCheckingPlatforms(prev => {
        const next = new Set(prev)
        next.delete(platform)
        return next
      })
    },
  })

  const needsAccountId = platform === 'cloudflare'
  const isCustomProvider = platform === 'custom'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!platform || !apiKey) return
    if (needsAccountId && !accountId) return
    if (isCustomProvider && (!customName || !customBaseUrl)) return

    if (isCustomProvider) {
      addKey.mutate({
        platform: 'custom',
        key: apiKey,
        label: label || undefined,
        customName,
        baseUrl: customBaseUrl,
        modelId: customModelId || undefined,
      })
      return
    }

    const key = needsAccountId ? `${accountId}:${apiKey}` : apiKey
    addKey.mutate({ platform, key, label: label || undefined })
  }

  const revealProviderKey = async (id: number) => {
    setRevealingKeyId(id)
    try {
      const data = await apiFetch<ApiKeyReveal>(`/api/keys/${id}/reveal`)
      setRevealedKeys(prev => ({ ...prev, [id]: data.key }))
      return data.key
    } finally {
      setRevealingKeyId(null)
    }
  }

  const hideProviderKey = (id: number) => {
    setRevealedKeys(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const copyProviderKey = async (id: number) => {
    const key = revealedKeys[id] ?? await revealProviderKey(id)
    await navigator.clipboard.writeText(key)
    setCopiedKeyId(id)
    setTimeout(() => setCopiedKeyId(null), 1500)
  }

  const healthKeyMap = new Map<number, { status: string; lastCheckedAt: string | null }>()
  for (const k of healthData?.keys ?? []) healthKeyMap.set(k.id, k)

  const builtinGroups = PLATFORMS.map(p => ({
    ...p,
    keys: keys.filter(k => k.platform === p.value),
  }))
  const customGroups = Array.from(new Set(keys.filter(k => k.platform.startsWith('custom:')).map(k => k.platform)))
    .map(value => {
      const platformKeys = keys.filter(k => k.platform === value)
      return {
        value,
        label: platformKeys[0]?.providerName ?? value,
        keys: platformKeys,
      }
    })
  const grouped = [...builtinGroups, ...customGroups].filter(p => p.keys.length > 0)
  const hasKeyCheckInProgress = checkingKeyIds.size > 0
  const hasProviderCheckInProgress = checkingPlatforms.size > 0
  const canSubmit = Boolean(
    platform &&
    apiKey &&
    (!needsAccountId || accountId) &&
    (!isCustomProvider || (customName && customBaseUrl)) &&
    !addKey.isPending
  )
  const selectedPlatformLabel = isCustomProvider
    ? t('keys.customProvider')
    : PLATFORMS.find(p => p.value === platform)?.label

  return (
    <div>
      <PageHeader
        title={t('keys.title')}
        description={t('keys.description')}
      />

      <div className="space-y-8">
        <UnifiedKeySection />
        <CcSwitchImportSection />

        <section>
          <h2 className="text-sm font-medium mb-3">{t('keys.addTitle')}</h2>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border p-4 bg-card">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('keys.platform')}</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as ProviderFormPlatform)}>
                <SelectTrigger className="w-[220px]">
                  <span className={`flex-1 text-left truncate ${selectedPlatformLabel ? '' : 'text-muted-foreground'}`}>
                    {selectedPlatformLabel ?? t('keys.selectProvider')}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                  <SelectItem value="custom">{t('keys.customProvider')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isCustomProvider && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('keys.customName')}</Label>
                  <Input
                    value={customName}
                    onChange={e => setCustomName(e.target.value)}
                    placeholder={t('keys.customNamePlaceholder')}
                    className="w-[180px]"
                  />
                </div>
                <div className="space-y-1.5 flex-1 min-w-[260px]">
                  <Label className="text-xs">{t('keys.customBaseUrl')}</Label>
                  <Input
                    value={customBaseUrl}
                    onChange={e => setCustomBaseUrl(e.target.value)}
                    placeholder={t('keys.customBaseUrlPlaceholder')}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('keys.customModelId')}</Label>
                  <Input
                    value={customModelId}
                    onChange={e => setCustomModelId(e.target.value)}
                    placeholder={t('keys.customModelIdPlaceholder')}
                    className="w-[190px] font-mono text-xs"
                  />
                </div>
              </>
            )}
            {needsAccountId && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t('keys.accountId')}</Label>
                <Input
                  value={accountId}
                  onChange={e => setAccountId(e.target.value)}
                  placeholder={t('keys.accountIdPlaceholder')}
                  className="w-[200px] font-mono text-xs"
                />
              </div>
            )}
            <div className="space-y-1.5 flex-1 min-w-[240px]">
              <Label className="text-xs">{needsAccountId ? t('keys.apiToken') : t('keys.apiKey')}</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={needsAccountId ? t('keys.tokenPlaceholder') : t('keys.keyPlaceholder')}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('keys.label')}</Label>
              <Input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder={t('keys.optional')}
                className="w-[160px]"
              />
            </div>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {addKey.isPending ? t('keys.adding') : t('keys.addKey')}
            </Button>
          </form>
          {isCustomProvider && (
            <p className="text-xs text-muted-foreground mt-2">
              {t('keys.customHelp')}
            </p>
          )}
          {addKey.isError && (
            <p className="text-destructive text-xs mt-2">{(addKey.error as Error).message}</p>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-medium">{t('keys.configuredTitle')}</h2>
            {keys.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => checkAll.mutate()}
                disabled={checkAll.isPending || hasKeyCheckInProgress || hasProviderCheckInProgress}
              >
                {checkAll.isPending ? t('keys.checking') : t('keys.checkAll')}
              </Button>
            )}
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : keys.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                {t('keys.empty')}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map(group => {
                const groupPlatform = group.value as Platform
                return (
                <div key={group.value}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <h3 className="text-sm font-medium">{group.label}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {group.keys.length} {t(group.keys.length === 1 ? 'keys.key' : 'keys.keys')}
                      </span>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => checkPlatform.mutate(groupPlatform)}
                        disabled={checkAll.isPending || checkingPlatforms.has(groupPlatform) || group.keys.some(k => checkingKeyIds.has(k.id))}
                      >
                        {checkingPlatforms.has(groupPlatform) ? t('keys.checking') : t('keys.checkProvider')}
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-lg border divide-y bg-card overflow-hidden">
                    {group.keys.map(k => {
                      const h = healthKeyMap.get(k.id)
                      const status = h?.status ?? k.status
                      const lastChecked = h?.lastCheckedAt
                      const revealedKey = revealedKeys[k.id]
                      const isRevealing = revealingKeyId === k.id
                      const isCheckingKey = checkingKeyIds.has(k.id)
                      const isCheckingPlatform = checkingPlatforms.has(k.platform)
                      return (
                        <div key={k.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                          <span className={`size-1.5 rounded-full flex-shrink-0 ${statusDot[status] ?? statusDot.unknown}`} />
                          <code className="text-xs font-mono flex-shrink-0">{revealedKey ?? k.maskedKey}</code>
                          {k.label && <span className="text-xs text-muted-foreground">{k.label}</span>}
                          <span className="text-xs text-muted-foreground">{t(`keys.status.${status}`)}</span>
                          <div className="flex-1" />
                          {lastChecked && (
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {new Date(lastChecked).toLocaleTimeString(language === 'zh-CN' ? 'zh-CN' : [], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                              if (revealedKey) hideProviderKey(k.id)
                              else void revealProviderKey(k.id)
                            }}
                            disabled={isRevealing}
                          >
                            {isRevealing ? t('common.loading') : revealedKey ? t('keys.hide') : t('keys.show')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => void copyProviderKey(k.id)}
                            disabled={isRevealing}
                          >
                            {copiedKeyId === k.id ? t('keys.copied') : t('keys.copy')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => checkKey.mutate(k.id)}
                            disabled={isCheckingKey || isCheckingPlatform || checkAll.isPending}
                          >
                            {isCheckingKey || isCheckingPlatform ? t('keys.checking') : t('keys.check')}
                          </Button>
                          <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" onClick={() => deleteKey.mutate(k.id)} disabled={deleteKey.isPending}>
                            {t('keys.remove')}
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
