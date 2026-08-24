import fetch from 'cross-fetch'
import type { SettingsService } from './SettingsService'

export type LlmProvider = 'lmstudio' | 'ollama'

export interface LlmConfig {
  provider: LlmProvider
  baseUrl: string
  model: string
  modelsUrl: string
  chatUrl: string
}

export interface LlmConnectionResult {
  config: LlmConfig
  models: string[]
}

export function normalizeLlmBaseUrl(provider: LlmProvider, value: string): string {
  const raw = value.trim()
  if (!raw) throw new Error('L\'URL du backend IA est vide.')

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`URL du backend IA invalide : ${raw}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('L\'URL du backend IA doit utiliser http:// ou https://.')
  }

  parsed.search = ''
  parsed.hash = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  if (provider === 'lmstudio') parsed.pathname = parsed.pathname.replace(/\/v1$/i, '')

  return parsed.toString().replace(/\/$/, '')
}

export function buildLlmConfig(values: {
  provider?: string | null
  baseUrl?: string | null
  model?: string | null
}): LlmConfig {
  const provider: LlmProvider = values.provider === 'ollama' ? 'ollama' : 'lmstudio'
  const defaultUrl = provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234'
  const baseUrl = normalizeLlmBaseUrl(provider, values.baseUrl || defaultUrl)

  return {
    provider,
    baseUrl,
    model: values.model?.trim() || '',
    modelsUrl: provider === 'ollama' ? `${baseUrl}/api/tags` : `${baseUrl}/v1/models`,
    chatUrl: provider === 'ollama' ? `${baseUrl}/api/chat` : `${baseUrl}/v1/chat/completions`,
  }
}

export class LlmService {
  constructor(private readonly settings: SettingsService) {}

  getConfig(): LlmConfig {
    return buildLlmConfig({
      provider: this.settings.aiProvider,
      baseUrl: this.settings.aiBaseUrl,
      model: this.settings.aiModel,
    })
  }

  async listModels(config = this.getConfig()): Promise<string[]> {
    console.log(`[LlmService] Listing models: provider=${config.provider} url=${config.modelsUrl}`)
    const res = await fetch(config.modelsUrl, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

    const data = await res.json() as {
      data?: { id?: string }[]
      models?: { name?: string }[]
    }
    const models = config.provider === 'ollama'
      ? (data.models ?? []).map(item => item.name?.trim()).filter((id): id is string => Boolean(id))
      : (data.data ?? []).map(item => item.id?.trim()).filter((id): id is string => Boolean(id))

    return [...new Set(models)]
  }

  async testConnection(): Promise<LlmConnectionResult> {
    const config = this.getConfig()
    console.log(`[LlmService] Connection test: provider=${config.provider} url=${config.modelsUrl}`)
    try {
      const models = await this.listModels(config)
      return { config, models }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Échec de connexion à ${config.modelsUrl} : ${detail}`)
    }
  }

  async resolveModel(config = this.getConfig()): Promise<string> {
    if (config.model && config.model !== 'local-model') return config.model

    const models = await this.listModels(config)
    if (!models[0]) {
      throw new Error(`Aucun modèle disponible sur ${config.modelsUrl}. Chargez un modèle dans le backend IA.`)
    }
    return models[0]
  }
}
