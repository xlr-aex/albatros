import { describe, expect, it } from 'vitest'
import { buildLlmConfig, normalizeLlmBaseUrl } from './LlmService'

describe('LM Studio URL construction', () => {
  it.each([
    'http://192.168.1.28:1234',
    'http://192.168.1.28:1234/',
    'http://192.168.1.28:1234/v1',
    'http://192.168.1.28:1234/v1/',
  ])('normalizes %s to the server root', value => {
    expect(normalizeLlmBaseUrl('lmstudio', value)).toBe('http://192.168.1.28:1234')
  })

  it('builds each endpoint exactly once', () => {
    const config = buildLlmConfig({
      provider: 'lmstudio',
      baseUrl: 'http://192.168.1.28:1234/v1/',
      model: 'exact-model-id',
    })

    expect(config.modelsUrl).toBe('http://192.168.1.28:1234/v1/models')
    expect(config.chatUrl).toBe('http://192.168.1.28:1234/v1/chat/completions')
    expect(config.model).toBe('exact-model-id')
  })

  it('rejects unsupported protocols', () => {
    expect(() => normalizeLlmBaseUrl('lmstudio', 'file:///tmp/lmstudio')).toThrow(/http/)
  })
})
