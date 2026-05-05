import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { useI18n } from '@/lib/i18n'

interface ProviderGuide {
  name: string
  url: string
  detailEn: string
  detailZh: string
  noteEn?: string
  noteZh?: string
}

const providers: ProviderGuide[] = [
  {
    name: 'Google AI Studio',
    url: 'https://aistudio.google.com/apikey',
    detailEn: 'Open API keys, create a key for your project, then paste the key here.',
    detailZh: '打开 API keys，给项目创建 key，然后粘贴到本应用。',
  },
  {
    name: 'Groq',
    url: 'https://console.groq.com/keys',
    detailEn: 'Create an API key in the Groq console.',
    detailZh: '在 Groq 控制台创建 API key。',
  },
  {
    name: 'Cerebras',
    url: 'https://cloud.cerebras.ai/platform/keys',
    detailEn: 'Create or copy a key from Cerebras Cloud.',
    detailZh: '在 Cerebras Cloud 创建或复制 key。',
  },
  {
    name: 'SambaNova',
    url: 'https://cloud.sambanova.ai/apis',
    detailEn: 'Open the SambaNova Cloud API section and create an access key.',
    detailZh: '进入 SambaNova Cloud 的 API 页面并创建访问 key。',
  },
  {
    name: 'NVIDIA NIM',
    url: 'https://build.nvidia.com/',
    detailEn: 'Sign in to NVIDIA API Catalog and generate a personal API key.',
    detailZh: '登录 NVIDIA API Catalog 后生成个人 API key。',
  },
  {
    name: 'Mistral',
    url: 'https://console.mistral.ai/api-keys/',
    detailEn: 'Create a key in La Plateforme API keys.',
    detailZh: '在 La Plateforme 的 API keys 页面创建 key。',
  },
  {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/settings/keys',
    detailEn: 'Create an OpenRouter key under account settings.',
    detailZh: '在 OpenRouter 账号设置里创建 key。',
  },
  {
    name: 'GitHub Models',
    url: 'https://github.com/settings/tokens',
    detailEn: 'Use a GitHub personal access token that can call GitHub Models.',
    detailZh: '使用可调用 GitHub Models 的 GitHub personal access token。',
  },
  {
    name: 'Cohere',
    url: 'https://dashboard.cohere.com/api-keys',
    detailEn: 'Create a trial or production key from the Cohere dashboard.',
    detailZh: '在 Cohere 控制台创建 trial 或 production key。',
  },
  {
    name: 'Cloudflare Workers AI',
    url: 'https://dash.cloudflare.com/profile/api-tokens',
    detailEn: 'Create an API token, then also copy your Account ID.',
    detailZh: '创建 API token，同时复制 Account ID。',
    noteEn: 'In Keys, fill Account ID separately and paste only the API token in the key field.',
    noteZh: '在密钥页单独填写 Account ID，key 输入框里只粘贴 API token。',
  },
  {
    name: 'Zhipu AI / Z.ai',
    url: 'https://z.ai/manage-apikey/apikey-list',
    detailEn: 'Create an API key from the Z.ai management console.',
    detailZh: '在 Z.ai 管理控制台创建 API key。',
  },
]

export default function ProviderGuidePage() {
  const { t, language } = useI18n()
  const isZh = language === 'zh-CN'

  return (
    <div>
      <PageHeader
        title={t('guide.title')}
        description={t('guide.description')}
      />

      <div className="space-y-6">
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-medium">{t('guide.customTitle')}</h2>
          <div className="mt-3 grid gap-3 text-sm text-muted-foreground">
            <p>{t('guide.customDescription')}</p>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <span className="text-foreground">{t('guide.customBaseUrl')}</span>
              <code className="font-mono">https://your-provider.example/v1</code>
              <span className="text-foreground">{t('guide.customKey')}</span>
              <span>{t('guide.customKeyValue')}</span>
              <span className="text-foreground">{t('guide.customModel')}</span>
              <span>{t('guide.customModelValue')}</span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium mb-3">{t('guide.providerTitle')}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {providers.map(provider => (
              <div key={provider.name} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium">{provider.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {isZh ? provider.detailZh : provider.detailEn}
                    </p>
                    {(isZh ? provider.noteZh : provider.noteEn) && (
                      <p className="text-xs text-muted-foreground mt-2">
                        {isZh ? provider.noteZh : provider.noteEn}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={t('guide.open')}
                    onClick={() => window.open(provider.url, '_blank', 'noopener,noreferrer')}
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
