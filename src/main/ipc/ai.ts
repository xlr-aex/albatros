/**
 * @file ipc/ai.ts
 * @description IPC handlers for AI streaming calls (LM Studio / Ollama).
 * Moves LLM network logic out of the renderer for security (CSP compliance).
 */

import { ipcMain } from 'electron'
import fetch from 'cross-fetch'

const _abortControllers = new Map<string, AbortController>()

export function registerAiHandlers(): void {
  /**
   * Starts an AI chat session.
   * Emits 'ai:chat-chunk' for each piece of text.
   * Emits 'ai:chat-end' or 'ai:chat-error' upon completion.
   */
  ipcMain.on('ai:chat-start', async (event, params: {
    provider: 'lmstudio' | 'ollama'
    baseUrl: string
    model: string
    systemPrompt: string
    messages: { role: string; content: string }[]
    requestId: string
  }) => {
    const { provider, baseUrl, model, systemPrompt, messages, requestId } = params
    const sender = event.sender

    // Cleanup previous request with same ID if it exists
    if (_abortControllers.has(requestId)) {
      _abortControllers.get(requestId)?.abort()
    }

    const controller = new AbortController()
    _abortControllers.set(requestId, controller)

    try {
      if (provider === 'ollama') {
        await streamOllama(baseUrl, model, systemPrompt, messages, controller.signal, (chunk) => {
          if (!sender.isDestroyed()) sender.send(`ai:chat-chunk:${requestId}`, chunk)
        })
      } else {
        await streamLmStudio(baseUrl, model, systemPrompt, messages, controller.signal, (chunk) => {
          if (!sender.isDestroyed()) sender.send(`ai:chat-chunk:${requestId}`, chunk)
        })
      }

      if (!sender.isDestroyed()) sender.send(`ai:chat-end:${requestId}`)
    } catch (err: any) {
      if (err.name === 'AbortError') return // Silent
      console.error(`[AI IPC] Error in ${provider} stream:`, err)
      if (!sender.isDestroyed()) {
        sender.send(`ai:chat-error:${requestId}`, err.message || String(err))
      }
    } finally {
      _abortControllers.delete(requestId)
    }
  })

  /**
   * Aborts an ongoing chat stream.
   */
  ipcMain.on('ai:chat-abort', (_event, requestId: string) => {
    if (_abortControllers.has(requestId)) {
      _abortControllers.get(requestId)?.abort()
      _abortControllers.delete(requestId)
    }
  })

  /**
   * Fetches available models from the local provider.
   */
  ipcMain.handle('ai:list-models', async (_event, params: { provider: 'lmstudio' | 'ollama', baseUrl: string }) => {
    const { provider, baseUrl } = params
    try {
      const endpoint = provider === 'ollama' ? `${baseUrl}/api/tags` : `${baseUrl}/v1/models`
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return []
      const data = await res.json()
      if (provider === 'ollama') {
        return (data.models || []).map((m: any) => m.name)
      } else {
        return (data.data || []).map((m: any) => m.id)
      }
    } catch (err) {
      console.warn(`[AI IPC] Failed to fetch models for ${provider}:`, err)
      return []
    }
  })
}

// ── Helpers: Provider Specific Streams ────────────────────────────────────────

async function streamLmStudio(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  signal: AbortSignal,
  onChunk: (chunk: string) => void
) {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`LM Studio: ${res.status} — ${errText}`)
  }

  const body = res.body as any // ReadableStream in node-fetch/cross-fetch
  if (!body) throw new Error('LM Studio: Response body is empty')

  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  // Standard SSE parsing logic
  for await (const value of body) {
    if (signal.aborted) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
       const trimmed = line.trim()
       if (!trimmed.startsWith('data:')) continue
       const data = trimmed.slice(5).trim()
       if (data === '[DONE]') return
       
       try {
         const parsed = JSON.parse(data)
         const deltaStr = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.delta?.reasoning_content
         if (deltaStr) onChunk(deltaStr)
       } catch { /* ignore parsing errors for partial lines */ }
    }
  }
}

async function streamOllama(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  signal: AbortSignal,
  onChunk: (chunk: string) => void
) {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`Ollama: ${res.status} — ${errText}`)
  }

  const body = res.body as any
  if (!body) throw new Error('Ollama: Response body is empty')

  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  // Ollama sends one JSON object per line (not SSE 'data:' format)
  for await (const value of body) {
    if (signal.aborted) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed.message?.content) onChunk(parsed.message.content)
        if (parsed.done) return
      } catch { /* ignore */ }
    }
  }
}
