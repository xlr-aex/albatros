/**
 * A deliberately small, local-only MCP surface for Albatros.
 *
 * It is hosted by Electron's main process so every write uses the same live
 * services as the UI. This avoids a second process writing directly to SQLite
 * while Laya is classifying articles.
 */

import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import * as z from 'zod/v4'
import type { ArticleService } from '../services/ArticleService'
import type { FeedService } from '../services/FeedService'
import type { SearchService } from '../services/SearchService'
import type { LayaService } from '../services/LayaService'
import type { Scheduler } from '../sync/Scheduler'
import { assertSafeExternalHttpUrl } from '../security/ExternalUrlPolicy'

const DEFAULT_PORT = 8765
const MAX_BODY_BYTES = 1_000_000
const TOKEN_SETTING_KEY = '_albatros_mcp_token'

type Services = {
  articles: ArticleService
  feeds: FeedService
  search: SearchService
  laya: LayaService
  scheduler: Scheduler
}

type ConnectionInfo = {
  running: boolean
  url: string
  token: string
}

type TimestampInput = number | string

type PostQuery = {
  query?: string
  match?: 'any' | 'all'
  groupIds?: number[]
  feedIds?: number[]
  since?: TimestampInput
  until?: TimestampInput
  limit?: number
  includeContent?: boolean
  contentChars?: number
  newestFirst?: boolean
}

const SEARCH_STOP_WORDS = new Set([
  'about', 'after', 'ainsi', 'avec', 'dans', 'des', 'dont', 'elle', 'elles', 'est', 'et', 'for', 'from', 'les', 'leur', 'mais',
  'par', 'pas', 'plus', 'pour', 'que', 'qui', 'sur', 'the', 'this', 'une', 'vous', 'with', 'your',
  'actualité', 'actualites', 'article', 'articles', 'dernier', 'derniere', 'derniers', 'dernieres', 'dernière', 'dernières', 'information', 'informations', 'latest', 'news', 'post', 'posts', 'rss',
])

const TECHNOLOGY_THEMES = [
  { id: 'local-inference', label: 'Inférence locale et optimisation', patterns: [/quantiz/i, /inference/i, /inférenc/i, /gguf/i, /vllm/i, /ollama/i, /llama\.cpp/i, /speculative/i, /kv.?cache/i, /distill/i, /moe/i, /gpu/i, /npu/i] },
  { id: 'models', label: 'Modèles, architectures et poids ouverts', patterns: [/\bllm\b/i, /language model/i, /mod[eè]le/i, /qwen/i, /gemma/i, /mistral/i, /open.?weight/i, /checkpoint/i, /transformer/i, /mixture of experts/i] },
  { id: 'agents', label: 'Agents, outils et automatisation', patterns: [/\bagent/i, /\bmcp\b/i, /tool.?use/i, /computer use/i, /browser.?use/i, /workflow/i, /orchestrat/i, /autonomous/i] },
  { id: 'voice-multimodal', label: 'Voix, audio et multimodal', patterns: [/\bvoice/i, /audio/i, /speech/i, /\basr\b/i, /tts/i, /full.?duplex/i, /multimodal/i, /vision/i, /image generation/i, /g[ée]n[ée]ration d.?image/i] },
  { id: 'rag-data', label: 'RAG, recherche et données', patterns: [/\brag\b/i, /retrieval/i, /vector/i, /embedding/i, /knowledge graph/i, /tabular/i, /document/i, /search/i, /mémoire/i, /memory/i] },
  { id: 'developer-tools', label: 'Outils de développement assistés', patterns: [/coding/i, /code.?gen/i, /ide/i, /compiler/i, /rust/i, /framework/i, /sdk/i, /debug/i, /developer/i, /devtool/i] },
  { id: 'security', label: 'Cybersécurité et reverse engineering', patterns: [/security/i, /s[eé]curit[eé]/i, /vulnerab/i, /exploit/i, /reverse/i, /malware/i, /cve/i, /bug bounty/i, /pentest/i, /forensic/i] },
  { id: 'privacy', label: 'Confidentialité et décentralisation', patterns: [/privacy/i, /confidential/i, /encrypt/i, /cryptograph/i, /anonymous/i, /decentral/i, /p2p/i, /tor/i] },
]

function normalizeTerms(query: string): string[] {
  return [...new Set(query
    .normalize('NFC')
    .toLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}._+-]{1,}/gu)
    ?.map(term => term.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(term => term.length >= 2 && !SEARCH_STOP_WORDS.has(term)) ?? [])]
    .slice(0, 12)
}

function toUnixSeconds(value: TimestampInput | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value > 20_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) throw new Error(`${label} doit être un timestamp Unix ou une date ISO valide.`)
  return Math.floor(parsed / 1000)
}

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : 'Erreur MCP inconnue'
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

export class AlbatrosMcpService {
  private server: HttpServer | null = null
  private running = false
  private readonly token: string
  private readonly port: number

  constructor(private readonly db: Database, private readonly services: Services) {
    this.token = this.getOrCreateToken()
    const configuredPort = Number(process.env.ALBATROS_MCP_PORT ?? DEFAULT_PORT)
    this.port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65536
      ? configuredPort
      : DEFAULT_PORT
  }

  getConnectionInfo(): ConnectionInfo {
    return {
      running: this.running,
      url: `http://127.0.0.1:${this.port}/mcp`,
      token: this.token,
    }
  }

  async start(): Promise<void> {
    if (this.server) return

    const server = createServer((request, response) => {
      void this.handleRequest(request, response)
    })
    this.server = server
    server.on('error', error => {
      console.error('[MCP] Local server error:', error.message)
      this.running = false
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.port, '127.0.0.1')
    })

    this.running = true
    const info = this.getConnectionInfo()
    console.log(`[MCP] Albatros local MCP ready at ${info.url}`)
    console.log(`[MCP] Bearer token (keep private): ${info.token}`)
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.running = false
    if (!server) return
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }

  private getOrCreateToken(): string {
    const envToken = process.env.ALBATROS_MCP_TOKEN?.trim()
    if (envToken && envToken.length >= 24) return envToken

    const stored = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(TOKEN_SETTING_KEY) as { value?: string } | undefined
    if (stored?.value && stored.value.length >= 24) return stored.value

    const token = randomBytes(32).toString('base64url')
    this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(TOKEN_SETTING_KEY, token)
    return token
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (!supplied) return false
    const expected = Buffer.from(this.token)
    const received = Buffer.from(supplied)
    return expected.length === received.length && timingSafeEqual(expected, received)
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ name: 'albatros-mcp', running: true }))
      return
    }

    if (request.url !== '/mcp') {
      response.writeHead(404).end()
      return
    }
    if (!this.isAuthorized(request)) {
      response.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="Albatros MCP"',
      })
      response.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    try {
      const body = request.method === 'POST' ? await this.readJsonBody(request) : undefined
      const server = this.createMcpServer()
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      await server.connect(transport)
      await transport.handleRequest(request, response, body)
      response.once('close', () => {
        void transport.close()
        void server.close()
      })
    } catch (error) {
      console.error('[MCP] Request failed:', error)
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }))
      }
    }
  }

  private async readJsonBody(request: IncomingMessage): Promise<unknown> {
    const parts: Buffer[] = []
    let size = 0
    for await (const part of request) {
      const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part)
      size += buffer.length
      if (size > MAX_BODY_BYTES) throw new Error('MCP request body is too large')
      parts.push(buffer)
    }
    const raw = Buffer.concat(parts).toString('utf8').trim()
    return raw ? JSON.parse(raw) : undefined
  }

  /**
   * MCP research must be forgiving: agents naturally formulate questions in
   * sentences, whereas SQLite FTS is most reliable with short keyword sets.
   * We therefore reduce a sentence to meaningful terms, search them with OR
   * by default, and fall back to an escaped LIKE search if FTS has no hit.
   */
  private searchPosts(options: PostQuery): Record<string, unknown> {
    const terms = normalizeTerms(options.query ?? '')
    if (options.query?.trim() && !terms.length) throw new Error('La requête ne contient aucun terme exploitable. Essayez des mots précis.')

    const since = toUnixSeconds(options.since, 'since')
    const until = toUnixSeconds(options.until, 'until')
    if (since !== undefined && until !== undefined && since > until) throw new Error('since doit être antérieur à until.')
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
    const filters: string[] = ["(a.enclosure_type IS NULL OR a.enclosure_type != 'reddit-comment')"]
    const bindings: (number | string)[] = []
    if (options.groupIds?.length) {
      filters.push(`f.group_id IN (${options.groupIds.map(() => '?').join(', ')})`)
      bindings.push(...options.groupIds)
    }
    if (options.feedIds?.length) {
      filters.push(`a.feed_id IN (${options.feedIds.map(() => '?').join(', ')})`)
      bindings.push(...options.feedIds)
    }
    if (since !== undefined) { filters.push('COALESCE(a.published_at, a.created_at) >= ?'); bindings.push(since) }
    if (until !== undefined) { filters.push('COALESCE(a.published_at, a.created_at) <= ?'); bindings.push(until) }

    const select = `
      a.id, a.feed_id, a.url, a.title, a.author, a.excerpt, a.summary,
      a.content_text, a.published_at, a.created_at, a.is_read, a.is_saved,
      f.title AS feed_title, g.id AS group_id, g.name AS group_name`
    const from = 'FROM articles a JOIN feeds f ON f.id = a.feed_id LEFT JOIN feed_groups g ON g.id = f.group_id'
    const sort = options.newestFirst
      ? 'ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC'
      : `ORDER BY CASE WHEN lower(COALESCE(a.title, '')) LIKE ? THEN 0 ELSE 1 END, COALESCE(a.published_at, a.created_at) DESC, a.id DESC`
    const queryLike = `%${(options.query ?? '').toLocaleLowerCase().replace(/[%_\\]/g, '\\$&')}%`
    const mapRows = (rows: Record<string, unknown>[]) => rows.map(row => {
      const content = String(row.content_text ?? row.excerpt ?? '')
      const maxChars = Math.min(Math.max(options.contentChars ?? 900, 100), 4000)
      return {
        id: Number(row.id),
        title: row.title ? String(row.title) : 'Sans titre',
        url: row.url ? String(row.url) : null,
        publishedAt: Number(row.published_at ?? row.created_at),
        source: { feedId: Number(row.feed_id), feed: row.feed_title ? String(row.feed_title) : 'Flux inconnu', groupId: row.group_id ? Number(row.group_id) : null, group: row.group_name ? String(row.group_name) : null },
        author: row.author ? String(row.author) : null,
        excerpt: row.excerpt ? String(row.excerpt) : null,
        summary: row.summary ? String(row.summary) : null,
        content: options.includeContent ? content.slice(0, maxChars) : undefined,
        isRead: row.is_read === 1,
        isSaved: row.is_saved === 1,
      }
    })

    if (!terms.length) {
      const sql = `SELECT ${select} ${from} WHERE ${filters.join(' AND ')} ${sort} LIMIT ?`
      const rows = this.db.prepare(sql).all(...bindings, ...(options.newestFirst ? [] : [queryLike]), limit) as Record<string, unknown>[]
      return { query: null, normalizedTerms: [], match: 'recent', returned: rows.length, posts: mapRows(rows) }
    }

    const matchMode = options.match ?? 'any'
    const ftsQuery = terms.map(term => `${term}*`).join(matchMode === 'all' ? ' AND ' : ' OR ')
    const ftsSql = `SELECT ${select} ${from} JOIN articles_fts fts ON fts.docid = a.id WHERE ${[...filters, 'articles_fts MATCH ?'].join(' AND ')} ${sort} LIMIT ?`
    let rows = this.db.prepare(ftsSql).all(...bindings, ftsQuery, ...(options.newestFirst ? [] : [queryLike]), limit) as Record<string, unknown>[]
    let fallbackUsed = false

    if (!rows.length) {
      // FTS can miss punctuation, acronyms and some foreign-language forms.
      // The fallback intentionally uses OR: a research agent can inspect a
      // broad, source-filtered result set instead of receiving a misleading [].
      const likePredicates = terms.map(() => `(a.title LIKE ? ESCAPE '\\' OR a.excerpt LIKE ? ESCAPE '\\' OR a.content_text LIKE ? ESCAPE '\\')`)
      const likeBindings = terms.flatMap(term => Array(3).fill(`%${term.replace(/[%_\\]/g, '\\$&')}%`))
      const likeSql = `SELECT ${select} ${from} WHERE ${[...filters, `(${likePredicates.join(' OR ')})`].join(' AND ')} ${sort} LIMIT ?`
      rows = this.db.prepare(likeSql).all(...bindings, ...likeBindings, ...(options.newestFirst ? [] : [queryLike]), limit) as Record<string, unknown>[]
      fallbackUsed = true
    }

    return { query: options.query, normalizedTerms: terms, match: matchMode, fallbackUsed, returned: rows.length, posts: mapRows(rows) }
  }

  private getTechnologyRadar(options: Omit<PostQuery, 'query' | 'includeContent'> & { days?: number; technicalOnly?: boolean }): Record<string, unknown> {
    const now = Math.floor(Date.now() / 1000)
    const since = options.since ?? now - Math.min(Math.max(options.days ?? 14, 1), 365) * 86400
    const defaultGroups = this.services.feeds.getGroups()
      .filter(group => /\b(ai|ia|hacking|osint|security|tech|technology)\b/i.test(group.name))
      .map(group => group.id)
    const corpus = this.searchPosts({
      ...options,
      since,
      groupIds: options.groupIds?.length ? options.groupIds : (options.technicalOnly === false ? undefined : defaultGroups),
      limit: Math.min(options.limit ?? 250, 300),
      newestFirst: true,
      includeContent: false,
    })
    const posts = corpus.posts as Array<Record<string, unknown>>
    const themes = TECHNOLOGY_THEMES.map(theme => {
      const matches = posts.filter(post => {
        const haystack = `${post.title ?? ''} ${post.excerpt ?? ''}`
        return theme.patterns.some(pattern => pattern.test(haystack))
      })
      const sources = [...new Set(matches.map(post => {
        const source = post.source as { feed?: string } | undefined
        return source?.feed ?? 'Flux inconnu'
      }))]
      return {
        id: theme.id,
        theme: theme.label,
        signalCount: matches.length,
        sources: sources.slice(0, 8),
        representativePosts: matches.slice(0, 8),
      }
    }).filter(theme => theme.signalCount > 0).sort((a, b) => b.signalCount - a.signalCount)

    return {
      methodology: 'Radar local par motifs techniques récents. Il ne recherche ni revenus ni bounties : l’agent doit déduire le potentiel à partir des avancées et citer les posts représentatifs.',
      since,
      scope: { groupIds: options.groupIds?.length ? options.groupIds : (options.technicalOnly === false ? 'all' : defaultGroups), feedIds: options.feedIds ?? [] },
      scannedPosts: posts.length,
      themes,
      unclassifiedRecentPosts: posts.filter(post => !themes.some(theme => (theme.representativePosts as Array<Record<string, unknown>>).some(match => match.id === post.id))).slice(0, 20),
    }
  }

  private createMcpServer(): McpServer {
    const server = new McpServer({ name: 'albatros', version: '1.0.0' }, {
      instructions: 'Use Albatros to search the user’s RSS library, manage explicitly requested source groups and feeds, and control explicitly requested Laya folder analyses.',
    })
    const { articles, feeds, laya } = this.services

    server.registerTool('search_posts', {
      title: 'Rechercher des posts Albatros',
      description: 'Recherche tolérante dans les posts RSS locaux. Accepte une question en langage naturel : les mots utiles sont extraits puis recherchés en OU par défaut, sans renvoyer une liste vide à cause d’une requête trop longue. Utilisez groupIds ou feedIds pour cibler des sources.',
      inputSchema: {
        query: z.string().trim().min(1).max(500),
        match: z.enum(['any', 'all']).optional().describe('any par défaut : au moins un terme pertinent ; all : tous les termes FTS, puis repli tolérant si aucun résultat.'),
        groupIds: z.array(z.number().int().positive()).max(100).optional(),
        feedIds: z.array(z.number().int().positive()).max(500).optional(),
        since: z.union([z.number(), z.string()]).optional().describe('Timestamp Unix ou date ISO 8601, par ex. 2026-10-01.'),
        until: z.union([z.number(), z.string()]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        includeContent: z.boolean().optional().describe('Inclut un extrait de corps de texte, utile pour vérifier le contexte.'),
        contentChars: z.number().int().min(100).max(4000).optional(),
        newestFirst: z.boolean().optional().describe('Trie strictement par date au lieu de privilégier les titres correspondants.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async (args) => {
      try { return result(this.searchPosts(args)) } catch (error) { return failure(error) }
    })

    server.registerTool('get_recent_posts', {
      title: 'Lire les posts récents avec filtres de sources',
      description: 'Retourne les posts les plus récents d’un ensemble de groupes ou flux, sans imposer de mots-clés. À utiliser avant une synthèse, un brief ou une veille quand le sujet est large.',
      inputSchema: {
        groupIds: z.array(z.number().int().positive()).max(100).optional(),
        feedIds: z.array(z.number().int().positive()).max(500).optional(),
        since: z.union([z.number(), z.string()]).optional(),
        until: z.union([z.number(), z.string()]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        includeContent: z.boolean().optional(),
        contentChars: z.number().int().min(100).max(4000).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async (args) => {
      try { return result(this.searchPosts({ ...args, newestFirst: true })) } catch (error) { return failure(error) }
    })

    server.registerTool('get_post_details', {
      title: 'Lire le contenu de posts précis',
      description: 'Récupère le contenu et les métadonnées de 1 à 10 posts connus. À utiliser après une recherche pour vérifier les faits et citer les sources.',
      inputSchema: {
        postIds: z.array(z.number().int().positive()).min(1).max(10),
        contentChars: z.number().int().min(200).max(8000).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ postIds, contentChars }) => {
      try {
        const maxChars = contentChars ?? 3000
        const posts = postIds.map(id => articles.getById(id)).filter(Boolean).map(post => ({
          id: post!.id,
          title: post!.title,
          url: post!.url,
          publishedAt: post!.published_at ?? post!.created_at,
          source: post!.feed_title,
          author: post!.author,
          excerpt: post!.excerpt,
          summary: post!.summary,
          content: (post!.content_text ?? post!.excerpt ?? '').slice(0, maxChars),
        }))
        return result({ requested: postIds.length, returned: posts.length, posts })
      } catch (error) { return failure(error) }
    })

    server.registerTool('list_laya_folders', {
      title: 'Lister les dossiers Laya',
      description: 'Liste les dossiers intelligents Laya locaux, leurs descriptions et leur nombre de posts.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async () => result(laya.listFolders()))

    server.registerTool('get_folder_posts', {
      title: 'Lire les posts d’un dossier Laya',
      description: 'Retourne les posts déjà classés dans un dossier Laya, du plus récent au plus ancien.',
      inputSchema: {
        folderId: z.number().int().positive(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ folderId, limit }) => {
      try { return result(articles.list({ laya_folder_id: folderId, limit: limit ?? 20 })) } catch (error) { return failure(error) }
    })

    server.registerTool('get_laya_status', {
      title: 'État de l’analyse Laya',
      description: 'Retourne l’avancement local, les posts restants, et l’état du worker Laya.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async () => result(laya.getStatus()))

    server.registerTool('list_source_groups', {
      title: 'Lister les dossiers de sources',
      description: 'Liste les groupes de flux RSS disponibles pour définir le périmètre d’un dossier Laya.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async () => result(feeds.getGroups()))

    server.registerTool('create_source_group', {
      title: 'Créer un dossier de sources',
      description: 'Crée un dossier visible dans la barre latérale pour organiser des flux RSS. L’opération est idempotente : un dossier existant avec le même nom est réutilisé.',
      inputSchema: {
        name: z.string().trim().min(1).max(120),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ name }) => {
      try {
        const existing = feeds.getGroups().find(group => group.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)
        if (existing) return result({ created: false, group: existing })
        const id = feeds.createGroup(name)
        const group = feeds.getGroups().find(candidate => candidate.id === id)
        return result({ created: true, group: group ?? { id, name } })
      } catch (error) { return failure(error) }
    })

    server.registerTool('add_feed', {
      title: 'Ajouter un flux RSS',
      description: 'Ajoute un flux RSS/Atom/JSON Feed et lance sa première synchronisation. Donnez groupId pour un dossier existant, ou groupName pour créer/réutiliser un dossier dans la même opération.',
      inputSchema: {
        url: z.string().trim().url().max(2_000),
        title: z.string().trim().min(1).max(300).optional().describe('Nom facultatif, remplacé par le titre du flux lors de la synchronisation si nécessaire.'),
        groupId: z.number().int().positive().optional(),
        groupName: z.string().trim().min(1).max(120).optional(),
        fetchIntervalSeconds: z.number().int().min(300).max(86_400).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    }, async ({ url, title, groupId, groupName, fetchIntervalSeconds }) => {
      try {
        if (groupId !== undefined && groupName !== undefined) {
          return failure(new Error('Utilisez groupId ou groupName, pas les deux.'))
        }

        await assertSafeExternalHttpUrl(url)

        let resolvedGroupId = groupId
        if (groupId !== undefined && !feeds.getGroups().some(group => group.id === groupId)) {
          return failure(new Error(`Le dossier de sources ${groupId} est introuvable.`))
        }
        if (groupName !== undefined) {
          const existing = feeds.getGroups().find(group => group.name.localeCompare(groupName, undefined, { sensitivity: 'accent' }) === 0)
          resolvedGroupId = existing?.id ?? feeds.createGroup(groupName)
        }

        const existing = feeds.getByUrl(url)
        const id = feeds.create({
          url,
          title,
          group_id: resolvedGroupId,
          fetch_interval_sec: fetchIntervalSeconds,
        })
        // Sync in the background: MCP responds immediately and the new feed
        // becomes usable even when its source is temporarily unreachable.
        void this.services.scheduler.refreshFeed(id)
        return result({
          added: !existing,
          feedId: id,
          url,
          groupId: resolvedGroupId ?? null,
          syncStarted: true,
        })
      } catch (error) { return failure(error) }
    })

    server.registerTool('list_feeds', {
      title: 'Lister les flux RSS',
      description: 'Liste les flux disponibles avec leurs identifiants, groupes et volumes. Utilisez ces identifiants pour filtrer précisément search_posts, get_recent_posts ou technology_radar.',
      inputSchema: {
        groupIds: z.array(z.number().int().positive()).max(100).optional(),
        query: z.string().trim().max(200).optional().describe('Filtre facultatif sur le nom du flux ou du groupe.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ groupIds, query }) => {
      const normalized = query?.toLocaleLowerCase()
      const selected = groupIds?.length ? new Set(groupIds) : null
      const rows = feeds.getAll().filter(feed => {
        if (selected && (!feed.group_id || !selected.has(feed.group_id))) return false
        if (!normalized) return true
        return `${feed.title ?? ''} ${feed.description ?? ''}`.toLocaleLowerCase().includes(normalized)
      }).map(feed => ({
        id: feed.id,
        title: feed.title,
        groupId: feed.group_id,
        articleCount: feed.article_count,
        unreadCount: feed.unread_count,
        language: feed.language,
        active: feed.is_active,
      }))
      return result({ returned: rows.length, feeds: rows })
    })

    server.registerTool('technology_radar', {
      title: 'Radar des avancées technologiques',
      description: 'Balaye les flux techniques récents et regroupe les signaux en thèmes (inférence locale, modèles, agents, voix, RAG, devtools, sécurité…). Ne recherche pas de termes financiers : le potentiel doit être déduit des avancées techniques et des posts cités.',
      inputSchema: {
        groupIds: z.array(z.number().int().positive()).max(100).optional(),
        feedIds: z.array(z.number().int().positive()).max(500).optional(),
        since: z.union([z.number(), z.string()]).optional(),
        days: z.number().int().min(1).max(365).optional().describe('Fenêtre utilisée si since est absent ; 14 jours par défaut.'),
        limit: z.number().int().min(20).max(300).optional().describe('Nombre maximal de posts analysés ; 250 par défaut.'),
        technicalOnly: z.boolean().optional().describe('Par défaut, cible automatiquement les groupes AI, Hacking, OSINT, Security et Tech.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async (args) => {
      try { return result(this.getTechnologyRadar(args)) } catch (error) { return failure(error) }
    })

    server.registerTool('create_laya_folder', {
      title: 'Créer un dossier Laya',
      description: 'Crée un dossier intelligent. La description doit préciser le sujet, ce qui est inclus et ce qui est exclu.',
      inputSchema: {
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().min(10).max(3000),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ name, description }) => {
      try { return result(laya.createFolder(name, description)) } catch (error) { return failure(error) }
    })

    server.registerTool('update_laya_folder', {
      title: 'Modifier un dossier Laya',
      description: 'Modifie le nom, la description ou l’activation d’un dossier Laya existant. Ne reclassifie pas automatiquement les anciens posts.',
      inputSchema: {
        folderId: z.number().int().positive(),
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().min(10).max(3000).optional(),
        enabled: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ folderId, name, description, enabled }) => {
      if (name === undefined && description === undefined && enabled === undefined) return failure(new Error('Indiquez au moins une modification.'))
      try {
        laya.updateFolder(folderId, { name, description, is_enabled: enabled })
        return result({ updated: true, folderId })
      } catch (error) { return failure(error) }
    })

    server.registerTool('set_laya_folder_scope', {
      title: 'Définir le périmètre d’un dossier Laya',
      description: 'Remplace le périmètre de sources : groupes de flux et/ou flux individuels. Les deux sélections se cumulent.',
      inputSchema: {
        folderId: z.number().int().positive(),
        groupIds: z.array(z.number().int().positive()).max(500).optional(),
        feedIds: z.array(z.number().int().positive()).max(2000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ folderId, groupIds, feedIds }) => {
      if (groupIds === undefined && feedIds === undefined) return failure(new Error('Indiquez groupIds et/ou feedIds.'))
      try {
        if (groupIds !== undefined) laya.setGroupScopes(folderId, groupIds)
        if (feedIds !== undefined) laya.setFeedScopes(folderId, feedIds)
        return result({ updated: true, folderId })
      } catch (error) { return failure(error) }
    })

    server.registerTool('reanalyze_laya_folder', {
      title: 'Ré-analyser un dossier Laya',
      description: 'Efface uniquement les décisions du périmètre de ce dossier puis relance son analyse locale. Les résultats apparaissent progressivement.',
      inputSchema: { folderId: z.number().int().positive() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ folderId }) => {
      try {
        laya.updateFolder(folderId, { is_enabled: true })
        laya.resetFolderScope(folderId)
        return result({ started: true, folderId })
      } catch (error) { return failure(error) }
    })

    server.registerTool('pause_laya_folder', {
      title: 'Mettre en pause un dossier Laya',
      description: 'Suspend l’analyse du dossier demandé sans modifier ses posts déjà classés.',
      inputSchema: { folderId: z.number().int().positive() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ folderId }) => {
      try {
        laya.updateFolder(folderId, { is_enabled: false })
        return result({ paused: true, folderId })
      } catch (error) { return failure(error) }
    })

    server.registerTool('resume_laya_folder', {
      title: 'Reprendre un dossier Laya',
      description: 'Réactive l’analyse du dossier demandé pour les nouveaux posts non encore classés.',
      inputSchema: { folderId: z.number().int().positive() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ folderId }) => {
      try {
        laya.updateFolder(folderId, { is_enabled: true })
        laya.trigger()
        return result({ resumed: true, folderId })
      } catch (error) { return failure(error) }
    })

    return server
  }
}
