/** Terms that represent positive text clauses in the advanced search syntax. */
export function extractSearchHighlightTerms(query: string): string[] {
  const terms: string[] = []
  const add = (value: string) => {
    const clean = value.trim().replace(/\*+/g, '')
    if (clean && !terms.some(term => term.localeCompare(clean, undefined, { sensitivity: 'accent' }) === 0)) terms.push(clean)
  }

  const withoutDates = query
    .replace(/\b(?:before|after):\d{4}-\d{2}-\d{2}\b/gi, ' ')
    .replace(/\b\d{4}\.\.\d{4}\b/g, ' ')

  for (const match of withoutDates.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|-?[\p{L}\p{N}_*]+/giu)) {
    const raw = match[0]
    if (raw.startsWith('-')) continue
    if (raw.startsWith('"')) {
      const phrase = match[1].replace(/\\"/g, '"').replace(/\*/g, ' ').replace(/\s+/g, ' ').trim()
      add(phrase)
      // A phrase may straddle markup/text nodes in the reader. Individual
      // words keep highlighting useful in that case.
      for (const word of phrase.match(/[\p{L}\p{N}_]+/gu) ?? []) add(word)
      continue
    }
    if (/^(AND|OR)$/i.test(raw)) continue
    add(raw)
  }
  return terms.sort((a, b) => b.length - a.length)
}
