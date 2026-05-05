import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type Language = 'en' | 'zh-CN'

const STORAGE_KEY = 'freellmapi-language'

const messages: Record<Language, Record<string, string>> = {
  en: {
    'app.language': 'Language',
    'app.theme': 'Toggle theme',
    'nav.playground': 'Playground',
    'nav.keys': 'Keys',
    'nav.fallback': 'Fallback',
    'nav.analytics': 'Analytics',
    'nav.guide': 'Get keys',

    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.unknownError': 'Unknown error',
    'common.noData': 'No data yet',
    'common.noErrors': 'No errors',
    'common.provider': 'Provider',
    'common.model': 'Model',
    'common.requests': 'Requests',
    'common.success': 'Success',
    'common.latency': 'Latency',
    'common.message': 'Message',
    'common.time': 'Time',

    'playground.title': 'Playground',
    'playground.description': 'Send a chat completion through the router and see which provider serves it.',
    'playground.autoModel': 'Auto (fallback chain)',
    'playground.clear': 'Clear',
    'playground.emptyTitle': 'Send a message to get started.',
    'playground.emptyDescription': 'Using {model}. Switch models in the selector above.',
    'playground.placeholder': 'Type a message... (Enter to send, Shift+Enter for newline)',
    'playground.sending': 'Sending...',
    'playground.send': 'Send',
    'playground.fallback': 'fallback',
    'playground.fallbacks': 'fallbacks',

    'keys.title': 'Keys',
    'keys.description': 'Provider credentials and the unified API key your apps connect with.',
    'keys.ccswitch.title': 'Import to CC Switch',
    'keys.ccswitch.description': 'Add FreeLLMAPI as a Claude Code or Codex provider with the current base URL and unified key.',
    'keys.ccswitch.claudeTitle': 'Claude Code',
    'keys.ccswitch.claudeDescription': 'Uses the Anthropic-compatible /v1/messages endpoint and routes Claude model names through the fallback chain.',
    'keys.ccswitch.codexTitle': 'Codex',
    'keys.ccswitch.codexDescription': 'Uses Codex chat provider mode against the OpenAI-compatible /v1/chat/completions endpoint.',
    'keys.ccswitch.import': 'Import',
    'keys.ccswitch.model': 'Model',
    'keys.unifiedTitle': 'Your unified API key',
    'keys.unifiedDescription': 'Use this as your OpenAI api_key; it authenticates requests to this proxy.',
    'keys.regenerate': 'Regenerate',
    'keys.hide': 'Hide',
    'keys.show': 'Show',
    'keys.copied': 'Copied',
    'keys.copy': 'Copy',
    'keys.baseUrl': 'Base URL',
    'keys.endpoint': 'Endpoint',
    'keys.checkAll': 'Check all keys',
    'keys.checking': 'Checking...',
    'keys.addTitle': 'Add a provider key',
    'keys.platform': 'Platform',
    'keys.selectProvider': 'Select provider',
    'keys.customProvider': 'Custom OpenAI-compatible',
    'keys.customName': 'Name',
    'keys.customNamePlaceholder': 'Local provider',
    'keys.customBaseUrl': 'Base URL',
    'keys.customBaseUrlPlaceholder': 'https://host.example/v1',
    'keys.customModelId': 'Model ID',
    'keys.customModelIdPlaceholder': 'optional',
    'keys.customHelp': 'Custom providers use OpenAI-compatible /chat/completions. If Model ID is empty, FreeLLMAPI imports models from /models.',
    'keys.accountId': 'Account ID',
    'keys.accountIdPlaceholder': 'a1b2c3d4...',
    'keys.apiToken': 'API token',
    'keys.apiKey': 'API key',
    'keys.tokenPlaceholder': 'Bearer token',
    'keys.keyPlaceholder': 'paste key here',
    'keys.label': 'Label',
    'keys.optional': 'optional',
    'keys.adding': 'Adding...',
    'keys.addKey': 'Add key',
    'keys.configuredTitle': 'Configured providers',
    'keys.empty': 'No provider keys yet. Add one above to start routing.',
    'keys.key': 'key',
    'keys.keys': 'keys',
    'keys.check': 'Check',
    'keys.checkProvider': 'Check provider',
    'keys.remove': 'Remove',
    'keys.status.healthy': 'healthy',
    'keys.status.rate_limited': 'rate-limited',
    'keys.status.invalid': 'invalid',
    'keys.status.error': 'error',
    'keys.status.unknown': 'unchecked',

    'guide.title': 'Get provider keys',
    'guide.description': 'Where to create provider API keys and what to paste into FreeLLMAPI.',
    'guide.customTitle': 'Custom providers',
    'guide.customDescription': 'Use this for any OpenAI-compatible service. Paste its /v1 base URL and API key; FreeLLMAPI adds discovered models to the fallback chain.',
    'guide.customBaseUrl': 'Base URL',
    'guide.customKey': 'Key',
    'guide.customKeyValue': 'The provider API key or bearer token',
    'guide.customModel': 'Model ID',
    'guide.customModelValue': 'Optional if the provider exposes /models',
    'guide.providerTitle': 'Built-in providers',
    'guide.open': 'Open provider page',

    'fallback.title': 'Fallback chain',
    'fallback.description': 'Drag to reorder. Requests try models top-to-bottom until one succeeds.',
    'fallback.refresh': 'Refresh nodes',
    'fallback.refreshing': 'Refreshing...',
    'fallback.refreshStatus': 'Last refresh {status}: +{added}, updated {updated}, disabled {disabled}',
    'fallback.sortIntelligence': 'Sort by intelligence',
    'fallback.sortSpeed': 'Sort by speed',
    'fallback.sortBudget': 'Sort by budget',
    'fallback.budgetTitle': 'Monthly token budget',
    'fallback.remaining': 'remaining',
    'fallback.of': 'of',
    'fallback.used': 'Used',
    'fallback.dragLabel': 'Drag to reorder',
    'fallback.penalty': 'penalty',
    'fallback.intelligenceRank': 'Intel #{rank}',
    'fallback.speedRank': 'Speed #{rank}',
    'fallback.monthlyTokens': '{value} tok/mo',
    'fallback.emptyBeforeLink': 'No models available. Add API keys on the ',
    'fallback.emptyLink': 'Keys page',
    'fallback.emptyAfterLink': ' first.',
    'fallback.discard': 'Discard',
    'fallback.saving': 'Saving...',
    'fallback.saveOrder': 'Save order',
    'fallback.hiddenNoKeys': 'Hidden (no keys): {platforms}',

    'analytics.title': 'Analytics',
    'analytics.description': 'Request volume, latency, token usage, and failures.',
    'analytics.successRate': 'Success rate',
    'analytics.inputTokens': 'Input tokens',
    'analytics.outputTokens': 'Output tokens',
    'analytics.avgLatency': 'Avg latency',
    'analytics.estimatedSavings': 'Est. savings',
    'analytics.requestsByProvider': 'Requests by provider',
    'analytics.avgLatencyByProvider': 'Avg latency by provider',
    'analytics.requestsOverTime': 'Requests over time',
    'analytics.successSeries': 'Success',
    'analytics.failureSeries': 'Failures',
    'analytics.perModel': 'Per-model breakdown',
    'analytics.inTokens': 'In tokens',
    'analytics.outTokens': 'Out tokens',
    'analytics.errorsByProvider': 'Errors by provider',
    'analytics.recentErrors': 'Recent errors',
  },
  'zh-CN': {
    'app.language': '语言',
    'app.theme': '切换主题',
    'nav.playground': '调试台',
    'nav.keys': '密钥',
    'nav.fallback': '回退链',
    'nav.analytics': '分析',
    'nav.guide': '获取 Key',

    'common.loading': '加载中...',
    'common.error': '错误',
    'common.unknownError': '未知错误',
    'common.noData': '暂无数据',
    'common.noErrors': '暂无错误',
    'common.provider': '服务商',
    'common.model': '模型',
    'common.requests': '请求数',
    'common.success': '成功率',
    'common.latency': '延迟',
    'common.message': '消息',
    'common.time': '时间',

    'playground.title': '调试台',
    'playground.description': '通过路由发送聊天补全请求，并查看实际由哪个服务商响应。',
    'playground.autoModel': '自动（回退链）',
    'playground.clear': '清空',
    'playground.emptyTitle': '发送一条消息开始测试。',
    'playground.emptyDescription': '当前使用 {model}。可在上方选择器切换模型。',
    'playground.placeholder': '输入消息...（Enter 发送，Shift+Enter 换行）',
    'playground.sending': '发送中...',
    'playground.send': '发送',
    'playground.fallback': '次回退',
    'playground.fallbacks': '次回退',

    'keys.title': '密钥',
    'keys.description': '管理服务商凭证，以及应用连接本代理时使用的统一 API key。',
    'keys.ccswitch.title': '导入到 CC Switch',
    'keys.ccswitch.description': '用当前基础 URL 和统一 API key，将 FreeLLMAPI 添加为 Claude Code 或 Codex 服务商。',
    'keys.ccswitch.claudeTitle': 'Claude Code',
    'keys.ccswitch.claudeDescription': '使用 Anthropic 兼容的 /v1/messages 端点，并将 Claude 模型名交给回退链自动路由。',
    'keys.ccswitch.codexTitle': 'Codex',
    'keys.ccswitch.codexDescription': '使用 Codex 的 chat provider 模式，连接 OpenAI 兼容的 /v1/chat/completions 端点。',
    'keys.ccswitch.import': '导入',
    'keys.ccswitch.model': '模型',
    'keys.unifiedTitle': '统一 API key',
    'keys.unifiedDescription': '将它作为 OpenAI api_key 使用；它会认证发送到本代理的请求。',
    'keys.regenerate': '重新生成',
    'keys.hide': '隐藏',
    'keys.show': '显示',
    'keys.copied': '已复制',
    'keys.copy': '复制',
    'keys.baseUrl': '基础 URL',
    'keys.endpoint': '端点',
    'keys.checkAll': '一键检测所有',
    'keys.checking': '检查中...',
    'keys.addTitle': '添加服务商 key',
    'keys.platform': '平台',
    'keys.selectProvider': '选择服务商',
    'keys.customProvider': '自定义 OpenAI 兼容服务商',
    'keys.customName': '名称',
    'keys.customNamePlaceholder': '本地服务商',
    'keys.customBaseUrl': '基础 URL',
    'keys.customBaseUrlPlaceholder': 'https://host.example/v1',
    'keys.customModelId': '模型 ID',
    'keys.customModelIdPlaceholder': '可选',
    'keys.customHelp': '自定义服务商按 OpenAI 兼容的 /chat/completions 调用。模型 ID 留空时，FreeLLMAPI 会从 /models 自动导入模型。',
    'keys.accountId': '账户 ID',
    'keys.accountIdPlaceholder': 'a1b2c3d4...',
    'keys.apiToken': 'API 令牌',
    'keys.apiKey': 'API key',
    'keys.tokenPlaceholder': 'Bearer 令牌',
    'keys.keyPlaceholder': '粘贴 key',
    'keys.label': '标签',
    'keys.optional': '可选',
    'keys.adding': '添加中...',
    'keys.addKey': '添加 key',
    'keys.configuredTitle': '已配置服务商',
    'keys.empty': '还没有服务商 key。请先在上方添加一个以开始路由。',
    'keys.key': '个 key',
    'keys.keys': '个 key',
    'keys.check': '检查',
    'keys.checkProvider': '检查此服务商',
    'keys.remove': '移除',
    'keys.status.healthy': '正常',
    'keys.status.rate_limited': '限流',
    'keys.status.invalid': '无效',
    'keys.status.error': '错误',
    'keys.status.unknown': '未检查',

    'guide.title': '获取服务商 Key',
    'guide.description': '各服务商 API key 的创建入口，以及在 FreeLLMAPI 中应该填写什么。',
    'guide.customTitle': '自定义服务商',
    'guide.customDescription': '任意 OpenAI 兼容服务都可以放这里。填写它的 /v1 基础 URL 和 API key，FreeLLMAPI 会把发现到的模型加入回退链。',
    'guide.customBaseUrl': '基础 URL',
    'guide.customKey': 'Key',
    'guide.customKeyValue': '服务商 API key 或 bearer token',
    'guide.customModel': '模型 ID',
    'guide.customModelValue': '如果服务商提供 /models，可以留空',
    'guide.providerTitle': '内置服务商',
    'guide.open': '打开服务商页面',

    'fallback.title': '回退链',
    'fallback.description': '拖拽调整顺序。请求会自上而下尝试模型，直到有一个成功响应。',
    'fallback.refresh': '刷新节点',
    'fallback.refreshing': '刷新中...',
    'fallback.refreshStatus': '最近刷新 {status}：新增 {added}，更新 {updated}，禁用 {disabled}',
    'fallback.sortIntelligence': '按智能排序',
    'fallback.sortSpeed': '按速度排序',
    'fallback.sortBudget': '按额度排序',
    'fallback.budgetTitle': '月度 Token 预算',
    'fallback.remaining': '剩余',
    'fallback.of': '共',
    'fallback.used': '已用',
    'fallback.dragLabel': '拖拽排序',
    'fallback.penalty': '惩罚',
    'fallback.intelligenceRank': '智能 #{rank}',
    'fallback.speedRank': '速度 #{rank}',
    'fallback.monthlyTokens': '{value} token/月',
    'fallback.emptyBeforeLink': '暂无可用模型。请先到',
    'fallback.emptyLink': '密钥页面',
    'fallback.emptyAfterLink': '添加 API key。',
    'fallback.discard': '放弃',
    'fallback.saving': '保存中...',
    'fallback.saveOrder': '保存顺序',
    'fallback.hiddenNoKeys': '已隐藏（无密钥）：{platforms}',

    'analytics.title': '分析',
    'analytics.description': '查看请求量、延迟、Token 用量和失败情况。',
    'analytics.successRate': '成功率',
    'analytics.inputTokens': '输入 Token',
    'analytics.outputTokens': '输出 Token',
    'analytics.avgLatency': '平均延迟',
    'analytics.estimatedSavings': '预估节省',
    'analytics.requestsByProvider': '按服务商统计请求',
    'analytics.avgLatencyByProvider': '按服务商统计平均延迟',
    'analytics.requestsOverTime': '请求趋势',
    'analytics.successSeries': '成功',
    'analytics.failureSeries': '失败',
    'analytics.perModel': '按模型明细',
    'analytics.inTokens': '输入 Token',
    'analytics.outTokens': '输出 Token',
    'analytics.errorsByProvider': '按服务商统计错误',
    'analytics.recentErrors': '最近错误',
  },
}

export const languageOptions: { value: Language; label: string; shortLabel: string }[] = [
  { value: 'en', label: 'English', shortLabel: 'EN' },
  { value: 'zh-CN', label: '简体中文', shortLabel: '中' },
]

interface I18nValue {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: string, values?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nValue | null>(null)

function getInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'en'

  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'zh-CN') return stored

  return window.navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage)

  useEffect(() => {
    document.documentElement.lang = language
    window.localStorage.setItem(STORAGE_KEY, language)
  }, [language])

  const value = useMemo<I18nValue>(() => ({
    language,
    setLanguage: setLanguageState,
    t: (key, values) => {
      const template = messages[language][key] ?? messages.en[key] ?? key
      if (!values) return template
      return Object.entries(values).reduce(
        (result, [name, replacement]) => result.replaceAll(`{${name}}`, String(replacement)),
        template
      )
    },
  }), [language])

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used within I18nProvider')
  return context
}
