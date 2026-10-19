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
  return <div className={styles.cardProgress} aria-label={`Avancement du tri pour ${name}`}>
    <div><strong>{progress ? `${percent} %` : '—'}</strong><small>{progress ? `${progress.processed} / ${progress.total}` : 'Chargement'}</small></div>
    <progress value={progress?.processed ?? 0} max={Math.max(progress?.total ?? 0, 1)} aria-label={`${percent} % des posts du périmètre de ${name} sont traités`} />
  </div>
}

function parsePrompt(description: string): PromptParts {
  const read = (label: string) => new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=\\n(?:Sujet principal|Inclure notamment|Exclure explicitement)\\s*:|$)`, 'i').exec(description)?.[1]?.trim() ?? ''
  const topic = read('Sujet principal')
  if (!topic) return { topic: description.trim(), include: '', exclude: '' }
  return { topic, include: read('Inclure notamment'), exclude: read('Exclure explicitement') }
}

function buildPrompt({ topic, include, exclude }: PromptParts): string {
  return [
    `Sujet principal : ${topic.trim()}`,
    include.trim() && `Inclure notamment : ${include.trim()}`,
    exclude.trim() && `Exclure explicitement : ${exclude.trim()}`,
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
    ? 'Worker indisponible'
    : status?.isPaused
      ? 'Analyse en pause'
    : !status?.workerReady && scopeTotal > 0
      ? 'Démarrage du modèle local'
      : status?.isProcessing
        ? 'Classement en cours'
        : status?.pending === 0
          ? 'Analyse terminée'
          : 'En attente'

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
      setScopeMessage('Périmètre enregistré.')
      void window.api.laya.trigger()
    } catch (error) {
      console.error(error)
      setScopeMessage('Impossible d’enregistrer le périmètre. Réessayez.')
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
      setCreateMessage(`« ${trimmedName} » est prêt à recevoir ses premiers posts.`)
      void window.api.laya.trigger()
    } catch (error) {
      console.error(error)
      setCreateMessage('Impossible de créer le dossier. Réessayez.')
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
    if (!window.confirm(`Supprimer le dossier « ${folder.name} » ? Les articles seront reclassés.`)) return
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
    if (!window.confirm(`Ré-analyser les posts de « ${folder.name} » et les posts encore non classés de ses dossiers sources ? Les autres dossiers ne seront pas modifiés.`)) return
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
          <p className={styles.eyebrow}>Classement local</p>
          <h1>Dossiers Laya</h1>
          <p className={styles.lede}>Les nouveaux posts sont classés en parallèle sur cet ordinateur, puis leur dossier est mémorisé.</p>
        </div>
        <div className={styles.status} aria-live="polite">
          <strong>{status ? statusLabel : 'Chargement…'}</strong>
          <span>{status ? `${processed} / ${scopeTotal} posts analysés (${percent} %)` : 'Lecture de l’état…'}</span>
          {status && <progress className={styles.progress} value={processed} max={Math.max(scopeTotal, 1)} aria-label={`${percent} % des posts du périmètre analysés`} />}
          {status && <small>{status.pending > 0 ? `${status.pending} post${status.pending === 1 ? '' : 's'} restant${status.pending === 1 ? '' : 's'} · résultats enregistrés au fil de l’eau` : 'Tous les posts du périmètre sont enregistrés'}</small>}
        </div>
      </header>

      <form className={styles.createForm} onSubmit={createFolder}>
        <div className={styles.createIntro}>
          <span>Nouveau dossier</span>
          <p>Définissez d’abord le sujet, puis affinez-le si nécessaire.</p>
        </div>
        <label>
          <span>Titre du dossier</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Intelligence artificielle" maxLength={100} required />
        </label>
        <label>
          <span>Sujet du dossier</span>
          <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Ex. Les annonces et sorties de modèles Qwen" maxLength={300} required />
        </label>
        <label>
          <span>À inclure <em>facultatif</em></span>
          <input value={includeRules} onChange={e => setIncludeRules(e.target.value)} placeholder="Ex. Qwen3, Qwen2.5, Alibaba Cloud et les modèles de langage" maxLength={300} />
        </label>
        <label>
          <span>À exclure <em>facultatif</em></span>
          <input value={excludeRules} onChange={e => setExcludeRules(e.target.value)} placeholder="Ex. modèles de génération d’images ou de vidéos" maxLength={300} />
        </label>
        <div className={styles.createAction}>
          <button type="submit" disabled={busy || !name.trim() || !topic.trim()}>{busy ? 'Création…' : 'Créer le dossier'}</button>
          {createMessage && <span className={createMessage.startsWith('Impossible') ? styles.formError : styles.formSuccess} role="status">{createMessage}</span>}
        </div>
      </form>

      <div className={styles.toolbar}>
        <span>{layaFolders.length} dossier{layaFolders.length === 1 ? '' : 's'} · {status?.total ?? 0} post{(status?.total ?? 0) === 1 ? '' : 's'} enregistrés</span>
        <div className={styles.toolbarActions}><button type="button" onClick={() => void window.api.laya.trigger()} disabled={busy || status?.isPaused}>Trier les nouveaux posts</button><button type="button" className={styles.pauseButton} onClick={() => void (status?.isPaused ? window.api.laya.resume() : window.api.laya.pause())} disabled={busy}>{status?.isPaused ? 'Reprendre l’analyse' : 'Mettre en pause'}</button></div>
      </div>
      {status?.workerError && <p className={styles.workerError}>{status.workerError}</p>}

      {layaFolders.length === 0 ? (
        <div className={styles.empty}><span>✦</span><h2>Créez votre premier dossier</h2><p>Ajoutez un titre et une description : Laya utilisera ces consignes pour classer les prochains posts.</p></div>
      ) : (
        <section className={styles.grid} aria-label="Dossiers Laya">
          {layaFolders.map(folder => editingId === folder.id ? (
            <article className={`${styles.card} ${scopeFolderId === folder.id ? styles.cardExpanded : ''}`} key={folder.id}>
              <input className={styles.editInput} value={editName} onChange={e => setEditName(e.target.value)} aria-label="Titre" autoFocus />
              <label className={styles.promptLabel}><span>Sujet du dossier</span><textarea value={editPrompt.topic} onChange={e => setEditPrompt(current => ({ ...current, topic: e.target.value }))} aria-label="Sujet du dossier" rows={2} /></label>
              <label className={styles.promptLabel}><span>À inclure <em>facultatif</em></span><textarea value={editPrompt.include} onChange={e => setEditPrompt(current => ({ ...current, include: e.target.value }))} aria-label="À inclure" rows={2} /></label>
              <label className={styles.promptLabel}><span>À exclure <em>facultatif</em></span><textarea value={editPrompt.exclude} onChange={e => setEditPrompt(current => ({ ...current, exclude: e.target.value }))} aria-label="À exclure" rows={2} /></label>
              <div className={styles.actions}><button onClick={() => void saveFolder(folder.id)} disabled={busy}>Enregistrer</button><button className={styles.secondary} onClick={() => setEditingId(null)}>Annuler</button></div>
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
                <span className={styles.openHint}>Ouvrir <ArrowIcon /></span>
              </button>
              <div className={styles.actions}><button className={styles.secondary} onClick={() => { setEditingId(folder.id); setEditName(folder.name); setEditPrompt(parsePrompt(folder.description)) }}>Modifier</button><button className={styles.secondary} onClick={() => { setScopeFolderId(id => id === folder.id ? null : folder.id); setScopeDirty(false); setScopeMessage(null) }}>Périmètre <span className={styles.scopeCount}>{(folderScopes[folder.id] ?? []).filter(group => group.enabled === 1).length + (feedScopes[folder.id] ?? []).filter(feed => feed.enabled === 1).length}</span></button><button className={styles.reanalyze} onClick={() => void reclassifyFolderScope(folder)} disabled={busy}>{(folder.article_count ?? 0) === 0 ? 'Lancer l’analyse' : 'Ré-analyser'}</button></div>
              <div className={styles.folderControl}>
                <span className={folder.is_enabled === 1 ? styles.activeState : styles.pausedState}><i aria-hidden="true" />{folder.is_enabled === 1 ? 'Analyse active' : 'Analyse en pause'}</span>
                <button className={folder.is_enabled === 1 ? styles.folderPause : styles.folderStart} onClick={() => void toggleFolder(folder)} disabled={busy}>{folder.is_enabled === 1 ? 'Mettre en pause' : 'Reprendre'}</button>
              </div>
              <button className={styles.danger} onClick={() => void deleteFolder(folder)} disabled={busy}>Supprimer le dossier</button>
              {scopeFolderId === folder.id && <section className={styles.folderScope} aria-label={`Périmètre du dossier ${folder.name}`}>
                <div className={styles.scopeIntro}><div><span>Périmètre d’analyse</span><h3>Choisissez les sources de « {folder.name} »</h3></div><p>Les dossiers et sources individuelles sélectionnés se cumulent.</p></div>
                <div className={styles.scopeColumns}>
                  <section className={styles.scopeSection}><div className={styles.scopeHeader}><div><strong>Dossiers de sources</strong><p className={styles.scopeHint}>Un dossier active tous les flux qu’il contient.</p></div><div className={styles.scopeActions}><button className={styles.secondary} onClick={() => updateGroupScopes(folder.id, (folderScopes[folder.id] ?? []).map(group => ({ ...group, enabled: 1 })))} disabled={busy}>Tous</button><button className={styles.secondary} onClick={() => updateGroupScopes(folder.id, (folderScopes[folder.id] ?? []).map(group => ({ ...group, enabled: 0 })))} disabled={busy}>Aucun</button></div></div><div className={styles.scopeList}>{(folderScopes[folder.id] ?? []).map(group => <label className={styles.scopeItem} key={group.group_id}><input type="checkbox" checked={group.enabled === 1} disabled={busy} onChange={() => updateGroupScopes(folder.id, (folderScopes[folder.id] ?? []).map(item => item.group_id === group.group_id ? { ...item, enabled: item.enabled === 1 ? 0 : 1 } : item))} /><span>{group.icon ? `${group.icon} ` : ''}{group.name} · {group.feed_count} flux</span></label>)}</div></section>
                  <section className={styles.scopeSection}><div className={styles.scopeHeader}><div><strong>Sources individuelles</strong><p className={styles.scopeHint}>Ajoutez une source sans activer tout son dossier.</p></div><div className={styles.scopeActions}><button className={styles.secondary} onClick={() => updateFeedScopes(folder.id, (feedScopes[folder.id] ?? []).map(feed => ({ ...feed, enabled: 1 })))} disabled={busy}>Toutes</button><button className={styles.secondary} onClick={() => updateFeedScopes(folder.id, (feedScopes[folder.id] ?? []).map(feed => ({ ...feed, enabled: 0 })))} disabled={busy}>Aucune</button></div></div><div className={styles.scopeList}>{(feedScopes[folder.id] ?? []).map(feed => <label className={styles.scopeItem} key={feed.feed_id} title={feed.url}><input type="checkbox" checked={feed.enabled === 1} disabled={busy} onChange={() => updateFeedScopes(folder.id, (feedScopes[folder.id] ?? []).map(item => item.feed_id === feed.feed_id ? { ...item, enabled: item.enabled === 1 ? 0 : 1 } : item))} /><span>{feed.group_name ? `${feed.group_name} · ` : ''}{feed.title || feed.url}</span></label>)}</div></section>
                </div>
                <footer className={styles.scopeFooter}><span className={scopeMessage?.startsWith('Impossible') ? styles.scopeError : styles.scopeMessage}>{scopeMessage ?? (scopeDirty ? 'Modifications non enregistrées.' : 'Aucune modification à enregistrer.')}</span><button type="button" onClick={() => void saveScope(folder.id)} disabled={busy || !scopeDirty}>{busy ? 'Enregistrement…' : 'Enregistrer le périmètre'}</button></footer>
              </section>}
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
