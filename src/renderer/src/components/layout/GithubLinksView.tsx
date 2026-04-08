import React, { useEffect, useState, useCallback } from 'react'
import styles from './GithubLinksView.module.css'

interface GithubLink {
  url: string
  linkText: string
  articleId: number
  articleTitle: string
  feedTitle: string
  groupTitle?: string
}

/** Robust image loader with retry + fallback for GitHub OpenGraph previews */
function RepoPreviewImage({ orgRepo, alt }: { orgRepo: string; alt: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'fallback'>('loading')
  const [retried, setRetried] = useState(false)

  // Primary: GitHub OpenGraph. Fallback: owner avatar + gradient.
  const owner = orgRepo.split('/')[0]
  const primarySrc = `https://opengraph.githubassets.com/1/${orgRepo}`
  const retrySrc = `https://opengraph.githubassets.com/${Date.now()}/${orgRepo}`
  const avatarSrc = `https://github.com/${owner}.png?size=80`

  const handleError = useCallback(() => {
    if (!retried) {
      // First failure: retry with cache-busting param
      setRetried(true)
    } else {
      // Second failure: show fallback placeholder
      setStatus('fallback')
    }
  }, [retried])

  const handleLoad = useCallback(() => {
    setStatus('loaded')
  }, [])

  if (status === 'fallback') {
    return (
      <div className={styles.cardImageFallback}>
        <img 
          src={avatarSrc} 
          alt="" 
          className={styles.fallbackAvatar}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <span className={styles.fallbackLabel}>{orgRepo}</span>
      </div>
    )
  }

  return (
    <img 
      src={retried ? retrySrc : primarySrc} 
      alt={alt} 
      className={`${styles.cardImage} ${status === 'loaded' ? styles.cardImageLoaded : ''}`}
      loading="lazy" 
      onError={handleError}
      onLoad={handleLoad}
    />
  )
}

export function GithubLinksView() {
  const [links, setLinks] = useState<GithubLink[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedGroup, setSelectedGroup] = useState<string>('All')
  const [selectedFeed, setSelectedFeed] = useState<string>('All')

  const fetchLinks = useCallback(() => {
    let mounted = true
    setLoading(true)
    window.api.articles.getGithubLinks().then(data => {
      if (mounted) {
        setLinks(data)
        setLoading(false)
      }
    }).catch(err => {
      console.error('Failed to load GitHub links', err)
      if (mounted) setLoading(false)
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const cancel = fetchLinks()
    return () => { cancel() }
  }, [fetchLinks])

  const uniqueGroups = Array.from(new Set(links.map(l => l.groupTitle || 'Ungrouped'))).sort()
  const uniqueFeeds = Array.from(new Set(
    links
      .filter(l => selectedGroup === 'All' || (selectedGroup === 'Ungrouped' && !l.groupTitle) || l.groupTitle === selectedGroup)
      .map(l => l.feedTitle)
  )).sort()

  const filteredLinks = links.filter(l => {
    if (selectedGroup !== 'All') {
      const match = selectedGroup === 'Ungrouped' ? !l.groupTitle : l.groupTitle === selectedGroup
      if (!match) return false
    }
    if (selectedFeed !== 'All' && l.feedTitle !== selectedFeed) {
      return false
    }
    return true
  })

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <h2 className={styles.title}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
            GitHub Discoveries
          </h2>
          <button 
            onClick={fetchLinks} 
            className={styles.reloadBtn} 
            disabled={loading}
            title="Refresh Links"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            Refresh
          </button>
        </div>
        <p className={styles.subtitle}>Explore repository preview cards extracted from your content feed.</p>
      </header>
      
      {!loading && links.length > 0 && (
        <div className={styles.filterBar}>
          <select 
            className={styles.filterSelect} 
            value={selectedGroup} 
            onChange={e => {
              setSelectedGroup(e.target.value)
              setSelectedFeed('All')
            }}
          >
            <option value="All">All Folders</option>
            {uniqueGroups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>

          <select 
            className={styles.filterSelect} 
            value={selectedFeed} 
            onChange={e => setSelectedFeed(e.target.value)}
          >
            <option value="All">All Feeds</option>
            {uniqueFeeds.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      )}

      <div className={styles.scrollArea}>
        {loading ? (
          <div className={styles.loaderState}>Loading repositories...</div>
        ) : links.length === 0 ? (
          <div className={styles.emptyState}>No GitHub links found in your synced articles yet.</div>
        ) : (
          <div className={styles.grid}>
            {filteredLinks.map((link, idx) => {
              let orgRepo = link.linkText
              let type = 'Repository'
              let highlight = ''
              
              try {
                const u = new URL(link.url)
                const parts = u.pathname.split('/').filter(Boolean)
                if (parts.length === 1) {
                  type = 'Profile'
                  orgRepo = parts[0]
                } else if (parts.length >= 2) {
                  orgRepo = `${parts[0]}/${parts[1]}`
                  if (parts[2] === 'issues' && parts[3]) {
                    type = 'Issue'
                    highlight = `#${parts[3]}`
                  } else if (parts[2] === 'pull' && parts[3]) {
                    type = 'Pull Request'
                    highlight = `#${parts[3]}`
                  } else if (parts[2] === 'blob' || parts[2] === 'tree') {
                    type = 'Code'
                    highlight = parts.slice(4).join('/')
                    if (highlight.length > 25) highlight = '.../' + highlight.slice(-20)
                  } else if (parts[2] === 'releases') {
                    type = 'Release'
                    highlight = parts[4] || 'Latest'
                  } else if (parts[2] === 'discussions') {
                    type = 'Discussion'
                  }
                }
              } catch {
                // Ignore parse errors
              }

              const showImage = type !== 'Profile'

              return (
                <a 
                  key={`${link.articleId}-${idx}`} 
                  href={link.url} 
                  className={styles.card}
                  onClick={e => {
                    e.preventDefault()
                    window.open(link.url, '_blank')
                  }}
                >
                  {showImage && (
                    <div className={styles.cardImageContainer}>
                      <RepoPreviewImage orgRepo={orgRepo} alt={orgRepo} />
                    </div>
                  )}

                  <div className={styles.cardContext}>
                    <span className={`${styles.typeBadge} ${styles[type.replace(' ', '')]}`}>{type}</span>
                    {highlight && <span className={styles.highlightText}>{highlight}</span>}
                  </div>
                  
                  <div className={styles.cardHeader}>
                    <svg className={styles.repoIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path><path d="M9 18c-4.51 2-5-2-7-2"></path></svg>
                    <span className={styles.repoName}>{orgRepo}</span>
                  </div>
                  
                  <div className={styles.cardFooter}>
                    <span className={styles.sourceLabel}>Found In</span>
                    <span className={styles.sourceArticle} title={link.articleTitle}>{link.articleTitle}</span>
                    <span className={styles.sourceFeed} title={link.feedTitle}>
                      — {link.feedTitle}
                    </span>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
