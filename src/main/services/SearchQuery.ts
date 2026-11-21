export type SearchQuery = {
  match: string | null
  publishedAfter: number | null
  publishedBefore: number | null
}

type Token = { kind: 'word' | 'phrase' | 'and' | 'or' | 'not' | 'lparen' | 'rparen'; value?: string }

/** Parses the small, documented search language into safe FTS4 and date filters. */
export function parseSearchQuery(input: string): SearchQuery {
  let publishedAfter: number | null = null
  let publishedBefore: number | null = null
  const source = input.replace(/\b(before|after):(\d{4}-\d{2}-\d{2})\b/gi, (_all, direction: string, date: string) => {
    const timestamp = parseDay(date)
    if (timestamp === null) return _all
    if (direction.toLowerCase() === 'before') publishedBefore = min(publishedBefore, timestamp)
    else publishedAfter = max(publishedAfter, timestamp)
    return ' '
  }).replace(/\b(\d{4})\.\.(\d{4})\b/g, (_all, first: string, last: string) => {
    const from = Number(first)
    const to = Number(last)
    if (from > to || from < 1970 || to > 9999) return _all
    publishedAfter = max(publishedAfter, Date.UTC(from, 0, 1) / 1000)
    publishedBefore = min(publishedBefore, Date.UTC(to + 1, 0, 1) / 1000)
    return ' '
  })

  const tokens = tokenize(source)
  const parser = new Parser(tokens)
  return { match: parser.parse(), publishedAfter, publishedBefore }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|\(|\)|\bAND\b|\bOR\b|-?[\p{L}\p{N}_*]+/giu
  for (const match of source.matchAll(pattern)) {
    const raw = match[0]
    if (raw.startsWith('"')) tokens.push({ kind: 'phrase', value: match[1].replace(/\\"/g, '"') })
    else if (raw === '(') tokens.push({ kind: 'lparen' })
    else if (raw === ')') tokens.push({ kind: 'rparen' })
    else if (/^AND$/i.test(raw)) tokens.push({ kind: 'and' })
    else if (/^OR$/i.test(raw)) tokens.push({ kind: 'or' })
    else if (raw.startsWith('-')) tokens.push({ kind: 'not' }, { kind: 'word', value: raw.slice(1) })
    else tokens.push({ kind: 'word', value: raw })
  }
  return tokens
}

class Parser {
  private index = 0
  constructor(private readonly tokens: Token[]) {}

  parse(): string | null {
    const expression = this.or()
    return expression || null
  }

  private or(): string | null {
    let left = this.and()
    while (this.peek('or')) {
      this.index++
      const right = this.and()
      if (left && right) left = `(${left} OR ${right})`
    }
    return left
  }

  private and(): string | null {
    let left = this.unary()
    while (this.peek('and') || this.startsExpression()) {
      if (this.peek('and')) this.index++
      const right = this.unary()
      if (left && right?.startsWith('NOT ')) left = `(${left} NOT ${right.slice(4)})`
      else if (left && right) left = `(${left} AND ${right})`
      else if (!left) left = right
    }
    return left
  }

  private unary(): string | null {
    if (this.peek('not')) {
      this.index++
      const value = this.unary()
      return value ? `NOT ${value}` : null
    }
    if (this.peek('lparen')) {
      this.index++
      const value = this.or()
      if (this.peek('rparen')) this.index++
      return value ? `(${value})` : null
    }
    const token = this.tokens[this.index]
    if (!token || (token.kind !== 'word' && token.kind !== 'phrase')) return null
    this.index++
    return toFts(token)
  }

  private startsExpression(): boolean {
    const kind = this.tokens[this.index]?.kind
    return kind === 'word' || kind === 'phrase' || kind === 'not' || kind === 'lparen'
  }
  private peek(kind: Token['kind']): boolean { return this.tokens[this.index]?.kind === kind }
}

function toFts(token: Token): string | null {
  if (token.kind === 'phrase') {
    const words = (token.value ?? '').match(/[\p{L}\p{N}_]+/gu) ?? []
    if (!words.length) return null
    // FTS4 has no phrase-position wildcard. NEAR preserves the useful intent
    // of `"alpha * beta"` while allowing a short gap between both words.
    if ((token.value ?? '').includes('*')) return words.map(word => `${word}*`).join(' NEAR/10 ')
    return `"${words.join(' ')}"`
  }
  const value = (token.value ?? '').replace(/[^\p{L}\p{N}_*]/gu, '')
  if (!value || value === '*') return null
  return `${value.replace(/\*+$/g, '')}*`
}

function parseDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const timestamp = Date.UTC(year, month - 1, day) / 1000
  const date = new Date(timestamp * 1000)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? timestamp : null
}

function min(current: number | null, next: number): number { return current === null ? next : Math.min(current, next) }
function max(current: number | null, next: number): number { return current === null ? next : Math.max(current, next) }
