import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useFeedStore } from '../../store/feedStore'
import { useUiStore } from '../../store/uiStore'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import styles from './AiDigestView.module.css'

// ─── Helpers: Streams ─────────────────────────────────────────────────────────

async function loadAiConfig() {
  const all = await window.api.settings.getAll()
  const provider = (all['ai_provider'] as 'lmstudio' | 'ollama') ?? 'lmstudio'
  const defaultUrl = provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234'
  let baseUrl = (all['ai_base_url'] || defaultUrl).trim().replace(/\/$/, '')
  if (provider === 'lmstudio' && baseUrl.endsWith('/v1')) {
    baseUrl = baseUrl.slice(0, -3).trim()
  }
  return {
    provider,
    baseUrl,
    model:   all['ai_model'] || (provider === 'ollama' ? 'llama3' : 'local-model'),
    systemPrompt: 'Tu es Albatros AI, un assistant de veille analytique. Tu réponds en français de manière extrêmement rigoureuse et concise.',
    summaryPrompt: String(all['ai_chatbot_summary_prompt'] || ""),
    newsPrompt: String(all['ai_chatbot_news_prompt'] || ""),
  }
}

async function* streamLmStudio(config: any, messages: {role: string, content: string}[], signal: AbortSignal) {
  const res = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    config.model,
      stream:   true,
      messages: [
        { role: 'system', content: config.systemPrompt },
        ...messages
      ],
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`LM Studio: ${res.status} — ${errText}`)
  }
  const reader = res.body!.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
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
        const deltaObj = parsed.choices?.[0]?.delta
        if (deltaObj) {
          const deltaStr = deltaObj.content || deltaObj.reasoning_content
          if (deltaStr) yield deltaStr
        }
      } catch {}
    }
  }
}

async function* streamOllama(config: any, messages: {role: string, content: string}[], signal: AbortSignal) {
  const res = await fetch(`${config.baseUrl}/api/chat`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    config.model,
      messages: [
        { role: 'system', content: config.systemPrompt },
        ...messages
      ],
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`Ollama: ${res.status} — ${errText}`)
  }
  const reader = res.body!.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed.message?.content) yield parsed.message.content
        if (parsed.done) return
      } catch {}
    }
  }
}

// ─── Component ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export function AiDigestView() {
  const { feeds, groups } = useFeedStore()
  const [timeframe, setTimeframe] = useState<'today' | 'week' | 'month'>('today')
  const [sourceId, setSourceId] = useState<string>('all')
  
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'streaming' | 'done'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [contextSources, setContextSources] = useState<{id: number, url: string, title: string}[]>([])
  
  const abortControllerRef = useRef<AbortController | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, state])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [])

  // Clear chat if knowledge base filters change
  const handleFilterChange = (setter: any, val: any) => {
    if (messages.length > 0) {
      if (!window.confirm("Changer les filtres effacera la conversation en cours. Continuer ?")) {
        return
      }
    }
    setter(val)
    setMessages([])
    setContextSources([])
    setErrorMsg('')
    setState('idle')
  }

  const handleSendMessage = async (forcedPrompt?: string) => {
    if (state === 'loading' || state === 'streaming') {
      abortControllerRef.current?.abort()
      setState('done') // or idle
      return
    }

    const contentToSend = (forcedPrompt || chatInput).trim()
    if (!contentToSend) return

    setChatInput('')
    setErrorMsg('')
    setState('loading')
    
    // Focus back if needed (for button clicks)
    setTimeout(() => inputRef.current?.focus(), 50)
    
    // Add user message to UI
    const updatedMessages = [...messages, { role: 'user' as const, content: contentToSend }]
    setMessages(updatedMessages)
    
    // Create an empty assistant message slot
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    try {
      const cfg = await loadAiConfig()
      
      // Auto-fetch model if needed
      if (!cfg.model || cfg.model === 'local-model') {
        const endpoint = cfg.provider === 'ollama' ? `${cfg.baseUrl}/api/tags` : `${cfg.baseUrl}/v1/models`
        const mRes = await fetch(endpoint, { signal: AbortSignal.timeout(5000) }).catch(()=>null)
        if (mRes && mRes.ok) {
          const mData = await mRes.json()
          const first = cfg.provider === 'ollama' ? mData.models?.[0]?.name : mData.data?.[0]?.id
          if (first) cfg.model = first
        }
      }

      // Build parameters for SQLite Knowledge Base
      const lower = contentToSend.toLowerCase()
      const isGenericSummary = lower.includes('résumé exhaustif')
      const isNewsAlert = lower.includes('annonces importantes') || lower.includes('annonces clés')
      
      const params: any = { 
        timeframe: timeframe,
        search_query: (isGenericSummary || isNewsAlert) ? undefined : contentToSend 
      }
      // Date filter logic moved to backend, today_only handled via timeframe
      // if (timeframe === 'today') params.today_only = true
      
      if (sourceId.startsWith('group_')) params.group_id = parseInt(sourceId.split('_')[1])
      else if (sourceId.startsWith('feed_')) params.feed_id = parseInt(sourceId.split('_')[1])

      const articles = await window.api.articles.getForDigest(params)

      // We alter the payload silently for the LLM without showing it in the UI
      const finalPayload = [...messages]
      
      if (articles.length > 0) {
        setContextSources(prev => {
          const dict = [...prev]
          articles.forEach((a: any) => {
            if (!dict.find(s => s.id === a.id)) dict.push({ id: a.id, url: a.url, title: a.title })
          })
          return dict
        })

        const contextBlocks = articles.map((a: any) => `<source id="${a.id}">
  <metadata>
    Titre: ${a.title}
    ID DE RÉFÉRENCE: ${a.id}
  </metadata>
  <content>${a.content}</content>
</source>`).join('\n')

        let instructionSet = `Tu es un assistant analytique expert. Tu effectues un "Scan Profond" parmi les 10 000 derniers articles de la base pour répondre précisément.

=== RÈGLES DE CITATION OBLIGATOIRES ===
1. Chaque fait mentionné DOIT être sourcé avec l'ID correspondant entre crochets (ex: [123]).
2. Utilise UNIQUEMENT les informations fournies.
3. Si la réponse nécessite de synthétiser un grand nombre d'ID, regroupe-les intelligemment.`

        if (isGenericSummary && cfg.summaryPrompt) {
          instructionSet = cfg.summaryPrompt
        } else if (isNewsAlert && cfg.newsPrompt) {
          instructionSet = cfg.newsPrompt
        }

        finalPayload.push({
          role: 'user',
          content: `${instructionSet}

=== CONTEXTE FOURNI (Échantillon de connaissance parmi ${articles.length} articles scannés) ===
<sources>
${contextBlocks.substring(0, 150000)}
</sources>

=== QUESTION DE L'UTILISATEUR ===
${contentToSend}`
        })
      } else {
        // Fallback or casual follow-up without FTS match
        finalPayload.push({
          role: 'user',
          content: contentToSend
        })
      }

      let streamFn
      if (cfg.provider === 'ollama') streamFn = streamOllama(cfg, finalPayload, signal)
      else streamFn = streamLmStudio(cfg, finalPayload, signal)

      setState('streaming')
      for await (const chunk of streamFn) {
        if (signal.aborted) break
        // Append chunk to the last assistant message
        setMessages(prev => {
          const newArr = [...prev]
          const lastIndex = newArr.length - 1
          if (lastIndex >= 0 && newArr[lastIndex].role === 'assistant') {
            newArr[lastIndex] = { ...newArr[lastIndex], content: newArr[lastIndex].content + chunk }
          }
          return newArr
        })
      }
      setState('done')

    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        setState('idle')
        return
      }
      // Overwrite the empty assistant message with the error
      setMessages(prev => {
        const newArr = [...prev]
        const lastIndex = newArr.length - 1
        if (lastIndex >= 0 && newArr[lastIndex].role === 'assistant' && !newArr[lastIndex].content) {
           newArr.pop()
        }
        return newArr
      })
      setErrorMsg((err as Error).message ?? String(err))
      setState('idle')
    }
  }

  const handleChatClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const anchor = target.closest('a')
    if (anchor) {
      e.preventDefault()
      const url = anchor.getAttribute('href')
      if (url) window.open(url, '_blank')
    }
  }, [])

  const renderMarkdown = (text: string) => {
    // 1. Inject UI elements for RAG source citations before feeding to marked
    // We allow [12], [ 12 ], and multiple space variations
    let preProcessed = text.replace(/\[\s*(\d+)\s*\]/g, (match, idStr) => {
      const id = parseInt(idStr)
      const source = contextSources.find(s => s.id === id)
      if (source) {
        return `<a href="${source.url}" target="_blank" class="${styles.citationBadge}" title="${source.title.replace(/"/g, '&quot;')}">${match}</a>`
      }
      return match
    })

    // 2. Parse Markdown
    const html = marked.parse(preProcessed, { async: false }) as string

    // 3. Purify HTML but allow our custom citation classes and links, plus table schemas
    const cleanHtml = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'code', 'pre', 'hr'],
      ALLOWED_ATTR: ['href', 'target', 'class', 'title']
    })

    return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: cleanHtml }} />
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className="drag-region" style={{ height: '30px', width: '100%', position: 'absolute', top: 0, left: 0 }} />
        <div className={styles.toolbar}>
          <div className={styles.brandIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
          </div>
          <span className={styles.toolbarLabel}>Connaissances:</span>
          <select value={timeframe} onChange={e => handleFilterChange(setTimeframe, e.target.value)} className={styles.select}>
            <option value="today">Aujourd'hui</option>
            <option value="week">Derniers Jours</option>
            <option value="month">Ce Mois</option>
          </select>

          <select value={sourceId} onChange={e => handleFilterChange(setSourceId, e.target.value)} className={styles.select}>
            <option value="all">Toutes les sources</option>
            <optgroup label="Dossiers">
              {groups.map(g => (
                <option key={`g-${g.id}`} value={`group_${g.id}`}>📁 {g.name}</option>
              ))}
            </optgroup>
            <optgroup label="Flux individuels">
              {feeds.map(f => (
                <option key={`f-${f.id}`} value={`feed_${f.id}`}>📰 {f.title || f.url}</option>
              ))}
            </optgroup>
          </select>
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} className={`${styles.button} ${styles.cleanBtn}`} style={{ marginLeft: 'auto' }} title="Vider la discussion">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          )}
        </div>
      </header>

      {/* ── CHAT HISTORY AREA ── */}
      <main className={styles.content}>
        <div className={styles.chatWrapper}>
          {messages.length === 0 && !errorMsg ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>🤖</div>
              <h2>Le savoir infusé.</h2>
              <p>Sélectionnez une période temporelle et une source en haut. Ensuite, envoyez votre premier message ou utilisez un raccourci :</p>
              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                <button className={styles.pillButton} onClick={() => handleSendMessage('Fais un résumé exhaustif des articles.')}>
                  📝 Résumé exhaustif
                </button>
                <button className={styles.pillButton} onClick={() => handleSendMessage("Quelles sont les annonces importantes ?")}>
                  🚨 Annonces clés
                </button>
              </div>
            </div>
          ) : (
             messages.map((msg, i) => (
               <div key={i} className={`${styles.messageRow} ${msg.role === 'user' ? styles.rowUser : styles.rowAssistant}`}>
                 {msg.role === 'assistant' && <div className={styles.avatar}>🤖</div>}
                 <div 
                   className={`${styles.bubble} ${msg.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}`}
                   onClick={msg.role === 'assistant' ? handleChatClick : undefined}
                 >
                   {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
                   {state === 'streaming' && i === messages.length - 1 && msg.role === 'assistant' && (
                     <span className={styles.cursor} />
                   )}
                 </div>
               </div>
             ))
          )}

          {state === 'loading' && (
            <div className={`${styles.messageRow} ${styles.rowAssistant}`}>
               <div className={styles.avatar}>🤖</div>
               <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
                 <div className={styles.loading}>
                   <div className={styles.spinner} />
                   Extraction de la connaissance et appel IA...
                 </div>
               </div>
            </div>
          )}

          {errorMsg && (
            <div className={styles.error} style={{ marginTop: '16px' }}>
              ERREUR : {errorMsg}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      </main>

      {/* ── FIXED INPUT STRIP ── */}
      <footer className={styles.footerStrip}>
        <div className={styles.inputWrapper}>
          <textarea
            ref={inputRef}
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendMessage()
              }
            }}
            placeholder="Posez votre question à l'IA... (Ex: Quels outils sont sortis hier ?)"
            className={styles.textarea}
            rows={2}
          />
          <button 
            onClick={() => handleSendMessage()} 
            className={`${styles.button} ${styles.sendBtn} ${state === 'loading' || state === 'streaming' ? styles.cancelBtn : ''}`}
          >
            {state === 'loading' || state === 'streaming' ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
            )}
          </button>
        </div>
      </footer>
    </div>
  )
}
