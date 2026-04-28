import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useFeedStore } from '../../store/feedStore'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import styles from './AiDigestView.module.css'

/**
 * NOTE: Provider streaming logic (streamLmStudio, streamOllama) has been migrated 
 * to the Main process (src/main/ipc/ai.ts) for security and CSP compliance.
 */


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
  const chatScrollRef = useRef<HTMLElement>(null)   // ref on the scrollable <main>
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isAtBottomRef = useRef(true)                // tracks if user is near the bottom
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  // Smart auto-scroll: only scroll to bottom if user hasn't scrolled up
  useEffect(() => {
    if (isAtBottomRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, state])

  // Detect whether the user is near the bottom of the chat
  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceFromBottom < 100
    isAtBottomRef.current = atBottom
    setShowScrollBtn(!atBottom)
  }, [])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [])

  // Clear chat if knowledge base filters change
  const handleFilterChange = <T extends string>(setter: React.Dispatch<React.SetStateAction<T>>, val: string) => {
    if (messages.length > 0) {
      if (!window.confirm("Changer les filtres effacera la conversation en cours. Continuer ?")) {
        return
      }
    }
    setter(val as unknown as T)
    setMessages([])
    setContextSources([])
    setErrorMsg('')
    setState('idle')
  }

  const handleSendMessage = async (forcedPrompt?: string) => {
    if (state === 'loading' || state === 'streaming') {
      abortControllerRef.current?.abort()
      setState('done')
      return
    }

    const contentToSend = (forcedPrompt || chatInput).trim()
    if (!contentToSend) return

    // When user sends a message, resume auto-scroll
    isAtBottomRef.current = true
    setShowScrollBtn(false)

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
      // 1. Load config
      const allSettings = await window.api.settings.getAll()
      const provider = (allSettings['ai_provider'] as 'lmstudio' | 'ollama') ?? 'lmstudio'
      const defaultUrl = provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234'
      let baseUrl = (allSettings['ai_base_url'] || defaultUrl).trim().replace(/\/$/, '')
      if (provider === 'lmstudio' && baseUrl.endsWith('/v1')) baseUrl = baseUrl.slice(0, -3).trim()

      const config = {
        provider,
        baseUrl,
        model: allSettings['ai_model'] || (provider === 'ollama' ? 'llama3' : 'local-model'),
        systemPrompt: 'Tu es Albatros AI, un assistant de veille analytique. Tu réponds en français de manière extrêmement rigoureuse et concise.',
        summaryPrompt: String(allSettings['ai_chatbot_summary_prompt'] || ""),
        newsPrompt: String(allSettings['ai_chatbot_news_prompt'] || ""),
      }
      
      // Auto-fetch model if needed via secure IPC
      if (!config.model || config.model === 'local-model') {
        const models = await window.api.ai.listModels({ provider: config.provider, baseUrl: config.baseUrl })
        if (models && models.length > 0) config.model = models[0]
      }

      // Build parameters for SQLite Knowledge Base
      const lower = contentToSend.toLowerCase()
      const isGenericSummary = lower.includes('résumé exhaustif')
      const isNewsAlert = lower.includes('annonces importantes') || lower.includes('annonces clés')
      
      const params: Record<string, string | number | boolean | undefined> = { 
        timeframe: timeframe,
        search_query: (isGenericSummary || isNewsAlert) ? undefined : contentToSend 
      }
      
      if (sourceId.startsWith('group_')) params.group_id = parseInt(sourceId.split('_')[1])
      else if (sourceId.startsWith('feed_')) params.feed_id = parseInt(sourceId.split('_')[1])

      const articles = await window.api.articles.getForDigest(params)

      // We alter the payload silently for the LLM without showing it in the UI
      const finalPayload: { role: 'user' | 'assistant', content: string }[] = updatedMessages.slice(0, -1) // use user history
      
      if (articles.length > 0) {
        setContextSources(prev => {
          const dict = [...prev]
          articles.forEach((a: {id: number, url: string, title: string}) => {
            if (!dict.find(s => s.id === a.id)) dict.push({ id: a.id, url: a.url, title: a.title })
          })
          return dict
        })

        const safePromptStr = (str: string | null | undefined) => {
          if (!str) return '';
          return str.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/===/g, '---');
        }

        const contextBlocks = articles.map((a: {id: number, url: string, title: string, content: string}) => `<source id="${a.id}">
  <metadata>
    Titre: ${safePromptStr(a.title)}
    ID DE RÉFÉRENCE: ${a.id}
  </metadata>
  <content>${safePromptStr(a.content)}</content>
</source>`).join('\n')

        let instructionSet = `Tu es un assistant analytique expert. Tu effectues un "Scan Profond" parmi les 10 000 derniers articles de la base pour répondre précisément.

=== RÈGLES DE CITATION OBLIGATOIRES ===
1. Chaque fait mentionné DOIT être sourcé avec l'ID correspondant entre crochets (ex: [123]).
2. Utilise UNIQUEMENT les informations fournies.
3. Si la réponse nécessite de synthétiser un grand nombre d'ID, regroupe-les intelligemment.`

        if (isGenericSummary && config.summaryPrompt) {
          instructionSet = config.summaryPrompt
        } else if (isNewsAlert && config.newsPrompt) {
          instructionSet = config.newsPrompt
        }

        finalPayload.push({
          role: 'user',
          content: `${instructionSet}

=== CONTEXTE FOURNI (Échantillon de connaissance parmi ${articles.length} articles scannés) ===
<sources>
${contextBlocks.substring(0, 150000)}
</sources>

=== QUESTION DE l'UTILISATEUR ===
${contentToSend}`
        })
      } else {
        finalPayload.push({ role: 'user', content: contentToSend })
      }

      // ── Start Stream via secure IPC ──
      const requestId = Math.random().toString(36).substring(7)
      abortControllerRef.current = new AbortController() // Local abort ref for UI state

      const stopStream = window.api.ai.streamChat(
        {
          provider: config.provider,
          baseUrl: config.baseUrl,
          model: config.model,
          systemPrompt: config.systemPrompt,
          messages: finalPayload,
          requestId
        },
        (chunk) => {
          setMessages(prev => {
            const newArr = [...prev]
            const lastIndex = newArr.length - 1
            if (lastIndex >= 0 && newArr[lastIndex].role === 'assistant') {
              newArr[lastIndex] = { ...newArr[lastIndex], content: newArr[lastIndex].content + chunk }
            }
            return newArr
          })
        },
        (err) => {
          setErrorMsg(err)
          setState('idle')
        },
        () => {
          setState('done')
        }
      )

      setState('streaming')
      
      // Hook the local abort to the stop function
      abortControllerRef.current.signal.addEventListener('abort', () => {
        stopStream()
      })

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
    <div 
      className={styles.container} 
      onClick={(e) => {
        // Only focus if the click was directly on main structural areas (not on selects/buttons/links)
        const target = e.target as HTMLElement
        const isInteractive = target.closest('button, a, select, input, textarea')
        if (!isInteractive) {
          inputRef.current?.focus()
        }
      }}
    >
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
      <main
        className={styles.content}
        ref={chatScrollRef as React.RefObject<HTMLDivElement>}
        onScroll={handleChatScroll}
      >
        <div className={styles.chatWrapper}>
          {messages.length === 0 && !errorMsg ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>🤖</div>
              <h2>Le savoir infusé.</h2>
              <p>Sélectionnez une période temporelle et une source en haut. Ensuite, envoyez votre premier message ou utilisez un raccourci :</p>
              <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
                <button className={styles.pillButton} onClick={() => handleSendMessage('Fais un résumé exhaustif des articles.')}>
                  📝 Résumé exhaustif
                  <span style={{ fontSize: '0.7rem', opacity: 0.7, display: 'block', marginTop: '2px' }}>Synthèse thématique de toutes les sources</span>
                </button>
                <button className={styles.pillButton} onClick={() => handleSendMessage("Quelles sont les annonces importantes ?")}>
                  🚨 Annonces clés
                  <span style={{ fontSize: '0.7rem', opacity: 0.7, display: 'block', marginTop: '2px' }}>Alertes critiques et nouveaux produits</span>
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
              <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>⚠ Erreur de connexion à l'IA</div>
              <div style={{ marginBottom: '6px' }}>{errorMsg}</div>
              <div style={{ fontSize: '0.78rem', opacity: 0.8 }}>
                {errorMsg.includes('fetch') || errorMsg.includes('Network')
                  ? '💡 Vérifiez que LM Studio / Ollama est lancé et accessible.'
                  : errorMsg.includes('timeout') || errorMsg.includes('Abort')
                    ? '💡 Délai dépassé. Vérifiez que le modèle est chargé dans le backend.'
                    : '💡 Vérifiez l\'URL de l\'API dans les Paramètres → ✦ IA.'}
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      </main>

      {/* Scroll-to-bottom button — visible when user has scrolled up during generation */}
      {showScrollBtn && (
        <button
          onClick={() => {
            isAtBottomRef.current = true
            setShowScrollBtn(false)
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
          }}
          style={{
            position: 'absolute',
            bottom: '130px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 16px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-light)',
            borderRadius: '9999px',
            color: 'var(--text-secondary)',
            fontSize: '0.78rem',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: 'var(--shadow-md)',
            zIndex: 10,
            transition: 'all 0.15s',
            backdropFilter: 'blur(8px)',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--brand-500)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-light)' }}
          aria-label="Reprendre le défilement automatique"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          Reprendre le défilement
        </button>
      )}

      {/* ── FIXED INPUT STRIP ── */}
      <footer className={styles.footerStrip}>
        {/* Active context indicator — Nielsen heuristic 1: visibility of system state */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 16px 0',
          fontSize: '0.72rem',
          color: 'var(--text-muted)',
        }}>
          <span style={{ color: 'var(--brand-400)', fontWeight: 600 }}>Contexte actif :</span>
          <span>
            {timeframe === 'today' ? 'Aujourd\'hui' : timeframe === 'week' ? 'Derniers jours' : 'Ce mois'}
            {' · '}
            {sourceId === 'all'
              ? 'Toutes les sources'
              : sourceId.startsWith('group_')
                ? 'Dossier sélectionné'
                : 'Flux sélectionné'}
          </span>
        </div>
        <div className={styles.inputWrapper}>
          <textarea
            ref={inputRef}
            autoFocus
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendMessage()
              }
            }}
            placeholder="Posez votre question… (Shift+Enter pour nouvelle ligne)"
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
