/**
 * @file components/layout/LayaFolderView.tsx
 * @description Local Laya folder management view.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { useFeedStore, type LayaFolder } from '../../store/feedStore'
import { useArticleStore } from '../../store/articleStore'
import styles from './LayaFolderView.module.css'

type LayaStatus = { pending: number; total: number; processed: number; scopeTotal: number; folderProgress: Record<number, { processed: number; total: number }>; isProcessing: boolean; isPaused: boolean; workerReady: boolean; folderCount: number; workerError: string | null }
type LayaGroupScope = { group_id: number; name: string; icon: string | null; feed_count: number; enabled: number }
type LayaFeedScope = { feed_id: number; title: string | null; url: string; group_name: string | null; enabled: number }
type PromptParts = { topic: string; include: string; exclude: string }

function FolderIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.75 7.5a2.25 2.25 0 0 1 2.25-2.25h4.04c.6 0 1.17.24 1.59.66l.96.96c.42.42.99.66 1.59.66H18a2.25 2.25 0 0 1 2.25 2.25v7.5A2.25 2.25 0 0 1 18 19.5H6a2.25 2.25 0 0 1-2.25-2.25v-9.75Z" /></svg>
}

function ArrowIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 10h11M11 5l5 5-5 5" /></svg>
}

function FolderProgress({ name, progress }: { name: string; progress?: { processed: number; total: number } }) {
  const percent = progress && progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0
  return <div className={styles.cardProgress} aria-label={`Sorting progress for ${name}`}>
    <div><strong>{progress ? `${percent} %` : '—'}</strong><small>{progress ? `${progress.processed} / ${progress.total}` : 'Loading'}</small></div>
    <progress value={progress?.processed ?? 0} max={Math.max(progress?.total ?? 0, 1)} aria-label={`${percent} % of posts in ${name} have been processed`} />
  </div>
}

function parsePrompt(description: string): PromptParts {
  const read = (labels: string[]) => new RegExp(`(?:${labels.join('|')})\\s*:\\s*([\\s\\S]*?)(?=\\n(?:Main topic|Include|Exclude|Sujet principal|Inclure notamment|Exclure explicitement)\\s*:|$)`, 'i').exec(description)?.[1]?.trim() ?? ''
  const topic = read(['Main topic', 'Sujet principal'])
  if (!topic) return { topic: description.trim(), include: '', exclude: '' }
  return { topic, include: read(['Include', 'Inclure notamment']), exclude: read(['Exclude', 'Exclure explicitement']) }
}

function buildPrompt({ topic, include, exclude }: PromptParts): string {
  return [
    `Main topic: ${topic.trim()}`,
    include.trim() && `Include: ${include.trim()}`,
    exclude.trim() && `Exclude: ${exclude.trim()}`,
  ].filter(Boolean).join('\n')
}

export function LayaFolderView() {
  const { layaFolders, setLayaFolders, setSelection } = useFeedStore()
  const { loadArticles } = useArticleStore()
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [includeRules, setIncludeRules] = useState('')
  const [excludeRules, setExcludeRules] = useState('')
  const [createMessage, setCreateMessage] = useState<string | null>(null)
  const [status, setStatus] = useState<LayaStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editPrompt, setEditPrompt] = useState<PromptParts>({ topic: '', include: '', exclude: '' })
  const [folderScopes, setFolderScopes] = useState<Record<number, LayaGroupScope[]>>({})
  const [feedScopes, setFeedScopes] = useState<Record<number, LayaFeedScope[]>>({})
  const [scopeFolderId, setScopeFolderId] = useState<number | null>(null)
  const [scopeDirty, setScopeDirty] = useState(false)
  const [scopeMessage, setScopeMessage] = useState<string | null>(null)
  const processed = status?.processed ?? 0
  const scopeTotal = status?.scopeTotal ?? 0
  const percent = scopeTotal > 0 ? Math.round((processed / scopeTotal) * 100) : 0
  const statusLabel = status?.workerError
    ? 'Worker unavailable'
    : status?.isPaused
      ? 'Analysis paused'
    : !status?.workerReady && scopeTotal > 0
      ? 'Starting local model'
      : status?.isProcessing
        ? 'Sorting in progress'
        : status?.pending === 0
          ? 'Analysis complete'
          : 'Waiting'

  const refreshFolders = useCallback(async () => {
    const folders = await window.api.laya.listFolders() as LayaFolder[]
    setLayaFolders(folders)
    const scopes = await Promise.all(folders.map(async folder => {
      const [groups, feeds] = await Promise.all([
        window.api.laya.listGroupScopes(folder.id) as Promise<LayaGroupScope[]>,
        window.api.laya.listFeedScopes(folder.id) as Promise<LayaFeedScope[]>,
      ])
      return [folder.id, groups, feeds] as const
    }))
    setFolderScopes(Object.fromEntries(scopes.map(([id, groups]) => [id, groups])))
    setFeedScopes(Object.fromEntries(scopes.map(([id, , feeds]) => [id, feeds])))
  }, [setLayaFolders])

  useEffect(() => {
    void window.api.laya.getStatus().then(setStatus).catch(console.error)
    void refreshFolders().catch(console.error)
    const unsubscribe = window.api.laya.onStatus(setStatus)
    return () => { unsubscribe() }
  }, [refreshFolders])

  const updateGroupScopes = (folderId: number, next: LayaGroupScope[]) => {
    setFolderScopes(current => ({ ...current, [folderId]: next }))
    setScopeDirty(true)
    setScopeMessage(null)
  }

  const updateFeedScopes = (folderId: number, next: LayaFeedScope[]) => {
    setFeedScopes(current => ({ ...current, [folderId]: next }))
    setScopeDirty(true)
    setScopeMessage(null)
  }

  const saveScope = async (folderId: number) => {
    setBusy(true)
    setScopeMessage(null)
    try {
      await Promise.all([
        window.api.laya.setGroupScopes(folderId, (folderScopes[folderId] ?? []).filter(group => group.enabled === 1).map(group => group.group_id)),
        window.api.laya.setFeedScopes(folderId, (feedScopes[folderId] ?? []).filter(feed => feed.enabled === 1).map(feed => feed.feed_id)),
      ])
      setScopeDirty(false)
      setScopeMessage('Scope saved.')
      void window.api.laya.trigger()
    } catch (error) {
      console.error(error)
      setScopeMessage('Could not save the scope. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const toggleFolder = async (folder: LayaFolder) => {
    setBusy(true)
    try {
      await window.api.laya.updateFolder(folder.id, { is_enabled: folder.is_enabled !== 1 })
      await refreshFolders()
      setStatus(await window.api.laya.getStatus() as LayaStatus)
    } finally {
      setBusy(false)
    }
  }

  const createFolder = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return
    setBusy(true)
    setCreateMessage(null)
    try {
      await window.api.laya.createFolder(trimmedName, buildPrompt({ topic, include: includeRules, exclude: excludeRules }))
      setName('')
      setTopic('')
      setIncludeRules('')
      setExcludeRules('')
      await refreshFolders()
      setCreateMessage(`“${trimmedName}” is ready for its first posts.`)
      void window.api.laya.trigger()
    } catch (error) {
      console.error(error)
      setCreateMessage('Could not create the folder. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const saveFolder = async (id: number) => {
    const trimmedName = editName.trim()
    if (!trimmedName) return
    setBusy(true)
    try {
      await window.api.laya.updateFolder(id, { name: trimmedName, description: buildPrompt(editPrompt) })
      setEditingId(null)
      await refreshFolders()
    } finally {
      setBusy(false)
    }
  }

  const deleteFolder = async (folder: LayaFolder) => {
    if (!window.confirm(`Delete “${folder.name}”? Its articles will be sorted again.`)) return
    setBusy(true)
    try {
      await window.api.laya.deleteFolder(folder.id)
      await refreshFolders()
    } finally {
      setBusy(false)
    }
  }

  const openFolder = (folder: LayaFolder) => {
    setSelection({ type: 'laya-folder', layaFolderId: folder.id })
    void loadArticles({ laya_folder_id: folder.id })
  }

  const reclassifyFolderScope = async (folder: LayaFolder) => {
    if (!window.confirm(`Analyze posts in “${folder.name}” again, including unclassified posts from its source folders? Other folders will not be changed.`)) return
    setBusy(true)
    try {
      await window.api.laya.resetFolderScope(folder.id)
      await refreshFolders()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={styles.view}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Local sorting</p>
          <h1>Laya folders</h1>
          <p className={styles.lede}>New posts are sorted locally in parallel, then saved to their folder.</p>
        </div>
        <div className={styles.status} aria-live="polite">
          <strong>{status ? statusLabel : 'Loading…'}</strong>
          <span>{status ? `${processed} / ${scopeTotal} posts processed (${percent} %)` : 'Reading status…'}</span>
          {status && <progress className={styles.progress} value={processed} max={Math.max(scopeTotal, 1)} aria-label={`${percent} % of posts in scope processed`} />}
          {status && <small>{status.pending > 0 ? `${status.pending} post${status.pending === 1 ? '' : 's'} remaining · results saved as they are processed` : 'All posts in scope are saved'}</small>}
        </div>
      </header>

      <form className={styles.createForm} onSubmit={createFolder}>
        <div className={styles.createIntro}>
          <span>New folder</span>
          <p>Define the topic first, then refine it if needed.</p>
        </div>
        <label>
          <span>Folder title</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Artificial intelligence" maxLength={100} required />
        </label>
        <label>
          <span>Folder topic</span>
          <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Qwen model announcements and releases" maxLength={300} required />
        </label>
        <label>
          <span>Include <em>optional</em></span>
          <input value={includeRules} onChange={e => setIncludeRules(e.target.value)} placeholder="e.g. Qwen3, Qwen2.5, Alibaba Cloud and language models" maxLength={300} />
        </label>
        <label>
          <span>Exclude <em>optional</em></span>
          <input value={excludeRules} onChange={e => setExcludeRules(e.target.value)} placeholder="e.g. image or video generation models" maxLength={300} />
        </label>
        <div className={styles.createAction}>
          <button type="submit" disabled={busy || !name.trim() || !topic.trim()}>{busy ? 'Creating…' : 'Create folder'}</button>
          {createMessage && <span className={createMessage.startsWith('Could not') ? styles.formError : styles.formSuccess} role="status">{createMessage}</span>}
        </div>
      </form>

      <div className={styles.toolbar}>
        <span>{layaFolders.length} folder{layaFolders.length === 1 ? '' : 's'} · {status?.total ?? 0} post{(status?.total ?? 0) === 1 ? '' : 's'} saved</span>
        <div className={styles.toolbarActions}><button type="button" onClick={() => void window.api.laya.trigger()} disabled={busy || status?.isPaused}>Sort new posts</button><button type="button" className={styles.pauseButton} onClick={() => void (status?.isPaused ? window.api.laya.resume() : window.api.laya.pause())} disabled={busy}>{status?.isPaused ? 'Resume analysis' : 'Pause'}</button></div>
      </div>
      {status?.workerError && <p className={styles.workerError}>{status.workerError}</p>}

      {layaFolders.length === 0 ? (
        <div className={styles.empty}><span>✦</span><h2>Create your first folder</h2><p>Add a title and description. Laya will use them to sort upcoming posts.</p></div>
      ) : (
        <section className={styles.grid} aria-label="Laya folders">
          {layaFolders.map(folder => editingId === folder.id ? (
            <article className={`${styles.card} ${scopeFolderId === folder.id ? styles.cardExpanded : ''}`} key={folder.id}>
              <input className={styles.editInput} value={editName} onChange={e => setEditName(e.target.value)} aria-label="Title" autoFocus />
              <label className={styles.promptLabel}><span>Folder topic</span><textarea value={editPrompt.topic} onChange={e => setEditPrompt(current => ({ ...current, topic: e.target.value }))} aria-label="Folder topic" rows={2} /></label>
              <label className={styles.promptLabel}><span>Include <em>optional</em></span><textarea value={editPrompt.include} onChange={e => setEditPrompt(current => ({ ...current, include: e.target.value }))} aria-label="Include" rows={2} /></label>
              <label className={styles.promptLabel}><span>Exclude <em>optional</em></span><textarea value={editPrompt.exclude} onChange={e => setEditPrompt(current => ({ ...current, exclude: e.target.value }))} aria-label="Exclude" rows={2} /></label>
              <div className={styles.actions}><button onClick={() => void saveFolder(folder.id)} disabled={busy}>Save</button><button className={styles.secondary} onClick={() => setEditingId(null)}>Cancel</button></div>
            </article>
          ) : (
            <article className={`${styles.card} ${scopeFolderId === folder.id ? styles.cardExpanded : ''}`} key={folder.id}>
              <FolderProgress name={folder.name} progress={status?.folderProgress?.[folder.id]} />
              <button className={styles.openCard} onClick={() => openFolder(folder)}>
                <div className={styles.cardHeading}>
                  <span className={styles.folderIcon}><FolderIcon /></span>
                  <div className={styles.folderTitle}>
                    <h2>{folder.name}</h2>
                  </div>
                  <strong className={styles.countBadge}>{folder.article_count ?? 0} <span>post{(folder.article_count ?? 0) === 1 ? '' : 's'}</span></strong>
                </div>
                {parsePrompt(folder.description).topic && <p className={styles.description} title={folder.description}>{parsePrompt(folder.description).topic}</p>}
                <span className={styles.openHint}>Open <ArrowIcon /></span>
              </button>
              <div className={styles.actions}><button className={styles.secondary} onClick={() => { setEditingId(folder.id); setEditName(folder.name); setEditPrompt(parsePrompt(folder.description)) }}>Edit</button><button className={styles.secondary} onClick={() => { setScopeFolderId(id => id === folder.id ? null : folder.id); setScopeDirty(false); setScopeMessage(null) }}>Scope <span className={styles.scopeCount}>{(folderScopes[folder.id] ?? []).filter(group => group.enabled === 1).length + (feedScopes[folder.id] ?? []).filter(feed => feed.enabled === 1).length}</span></button><button className={styles.reanalyze} onClick={() => void reclassifyFolderScope(folder)} disabled={busy}>{(folder.article_count ?? 0) === 0 ? 'Start analysis' : 'Analyze again'}</button></div>
              <div className={styles.folderControl}>
                <span className={folder.is_enabled === 1 ? styles.activeState : styles.pausedState}><i aria-hidden="true" />{folder.is_enabled === 1 ? 'Analysis active' : 'Analysis paused'}</span>
                <button className={folder.is_enabled === 1 ? styles.folderPause : styles.folderStart} onClick={() => void toggleFolder(folder)} disabled={busy}>{folder.is_enabled === 1 ? 'Pause' : 'Resume'}</button>
              </div>
              <button className={styles.danger} onClick={() => void deleteFolder(folder)} disabled={busy}>Delete folder</button>
              {scopeFolderId === folder.id && <section className={styles.folderScope} aria-label={`Scope for ${folder.name}`}>
                <div className={styles.scopeIntro}><div><span>Analysis scope</span><h3>Choose sources for “{folder.name}”</h3></div><p>Selected folders and individual sources are combined.</p></div>
                <div className={styles.scopeColumns}>
                  <section className={styles.scopeSection}><div className={styles.scopeHeader}><div><strong>Source folders</strong><p className={styles.scopeHint}>A folder enables every feed it contains.</p></div><div className={styles.scopeActions}><button className={styles.secondary} onClick={() => updateGroupScopes(folder.id, (folderScopes[folder.id] ?? []).map(group => ({ ...group, enabled: 1 })))} disabled={busy}>All</button><button className={styles.secondary} onClick={() => updateGroupScopes(folder.id, (folderScopes[folder.id] ?? []).map(group => ({ ...group, enabled: 0 })))} disabled={busy}>None</button></div></div><div className={styles.scopeList}>{(folderScopes[folder.id] ?? []).map(group => <label className={styles.scopeItem} key={group.group_id}><input type="checkbox" checked={group.enabled === 1} disabled={busy} onChange={() => updateGroupScopes(folder.id, (folderScopes[folder.id] ?? []).map(item => item.group_id === group.group_id ? { ...item, enabled: item.enabled === 1 ? 0 : 1 } : item))} /><span>{group.icon ? `${group.icon} ` : ''}{group.name} · {group.feed_count} feeds</span></label>)}</div></section>
                  <section className={styles.scopeSection}><div className={styles.scopeHeader}><div><strong>Individual sources</strong><p className={styles.scopeHint}>Add one source without enabling its entire folder.</p></div><div className={styles.scopeActions}><button className={styles.secondary} onClick={() => updateFeedScopes(folder.id, (feedScopes[folder.id] ?? []).map(feed => ({ ...feed, enabled: 1 })))} disabled={busy}>All</button><button className={styles.secondary} onClick={() => updateFeedScopes(folder.id, (feedScopes[folder.id] ?? []).map(feed => ({ ...feed, enabled: 0 })))} disabled={busy}>None</button></div></div><div className={styles.scopeList}>{(feedScopes[folder.id] ?? []).map(feed => <label className={styles.scopeItem} key={feed.feed_id} title={feed.url}><input type="checkbox" checked={feed.enabled === 1} disabled={busy} onChange={() => updateFeedScopes(folder.id, (feedScopes[folder.id] ?? []).map(item => item.feed_id === feed.feed_id ? { ...item, enabled: item.enabled === 1 ? 0 : 1 } : item))} /><span>{feed.group_name ? `${feed.group_name} · ` : ''}{feed.title || feed.url}</span></label>)}</div></section>
                </div>
                <footer className={styles.scopeFooter}><span className={scopeMessage?.startsWith('Could not') ? styles.scopeError : styles.scopeMessage}>{scopeMessage ?? (scopeDirty ? 'Unsaved changes.' : 'No changes to save.')}</span><button type="button" onClick={() => void saveScope(folder.id)} disabled={busy || !scopeDirty}>{busy ? 'Saving…' : 'Save scope'}</button></footer>
              </section>}
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
