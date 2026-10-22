import React from 'react'
import { extractSearchHighlightTerms } from '../../utils/searchHighlight'

export function HighlightText({ text, highlight }: { text: string; highlight: string }) {
  if (!highlight || !highlight.trim()) return <>{text}</>

  const words = extractSearchHighlightTerms(highlight)
  if (words.length > 0) {
    const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const regex = new RegExp(`(${escapedWords.join('|')})`, 'gi')
    const parts = text.split(regex)
    return (
      <>
        {parts.map((part, i) => (i % 2 === 1) ? (
          <mark key={i} style={{ backgroundColor: 'yellow', color: '#000', borderRadius: '2px', padding: '0 1px', fontWeight: 600 }}>{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        ))}
      </>
    )
  }

  return <>{text}</>
}
