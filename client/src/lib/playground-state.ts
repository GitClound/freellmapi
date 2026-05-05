export interface PlaygroundMessageMeta {
  platform?: string
  model?: string
  latency?: number
  fallbackAttempts?: number
}

export interface PlaygroundChatMessage {
  role: 'user' | 'assistant'
  content: string
  meta?: PlaygroundMessageMeta
}

const STORAGE_KEY = 'freellmapi.playground.messages.v1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMessageMeta(value: unknown): value is PlaygroundMessageMeta {
  if (value === undefined) return true
  if (!isRecord(value)) return false

  return (
    (value.platform === undefined || typeof value.platform === 'string') &&
    (value.model === undefined || typeof value.model === 'string') &&
    (value.latency === undefined || typeof value.latency === 'number') &&
    (value.fallbackAttempts === undefined || typeof value.fallbackAttempts === 'number')
  )
}

function isChatMessage(value: unknown): value is PlaygroundChatMessage {
  if (!isRecord(value)) return false

  return (
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    isMessageMeta(value.meta)
  )
}

export function loadPlaygroundMessages(): PlaygroundChatMessage[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.filter(isChatMessage)
  } catch {
    return []
  }
}

export function savePlaygroundMessages(messages: PlaygroundChatMessage[]) {
  if (typeof window === 'undefined') return

  try {
    if (messages.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
  } catch {
    // Storage can be unavailable in private mode or under quota pressure.
  }
}
