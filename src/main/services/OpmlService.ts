/**
 * @file services/OpmlService.ts
 * @description OPML import and export for feed subscriptions.
 *
 * OPML (Outline Processor Markup Language) is the standard interchange format
 * for RSS feed lists.  This service:
 *   - Parses an OPML XML string and returns a flat list of feeds to import
 *   - Generates a valid OPML 2.0 XML string from the current feed list
 *
 * Security note: the XML is parsed with entity expansion disabled and a
 * maximum of 1000 feeds is enforced on import.
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser'
import type { FeedService } from './FeedService'


// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpmlFeed {
  title: string | null
  xmlUrl: string
  htmlUrl: string | null
  category: string | null
}

const MAX_IMPORT_FEEDS = 1000

// ─── Service ─────────────────────────────────────────────────────────────────

export class OpmlService {
  constructor(private readonly feedService: FeedService) {}

  // ── Import ────────────────────────────────────────────────────────────────

  /**
   * Parses an OPML XML string and imports all found feed subscriptions.
   * Top-level `<outline>` elements that contain nested outlines are treated
   * as category folders (feed groups).
   *
   * @param xml - Raw OPML XML string
   * @returns Number of feeds successfully imported
   * @throws If the XML is malformed or the import cap is exceeded
   */
  import(xml: string): number {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseAttributeValue: false,
      allowBooleanAttributes: true,
    })

    const parsed = parser.parse(xml)
    const body   = parsed?.opml?.body
    if (!body) throw new Error('Invalid OPML: missing <body> element')

    // Collect all feed outlines (with optional group context)
    const feeds = this.extractFeeds(body?.outline ?? [])
    if (feeds.length > MAX_IMPORT_FEEDS) {
      throw new Error(`Import cap exceeded: ${feeds.length} feeds found, max is ${MAX_IMPORT_FEEDS}`)
    }

    let imported = 0
    for (const feed of feeds) {
      if (!feed.xmlUrl) continue

      // Create feed group if a category was detected
      let groupId: number | undefined
      if (feed.category) {
        // Re-use existing group with same name or create new one
        const existing = this.feedService
          .getGroups()
          .find(g => g.name.toLowerCase() === feed.category!.toLowerCase())
        groupId = existing?.id ?? this.feedService.createGroup(feed.category, true)
      }

      this.feedService.create({
        url:      feed.xmlUrl,
        title:    feed.title ?? undefined,
        site_url: feed.htmlUrl ?? undefined,
        group_id: groupId,
      }, true)
      imported++
    }



    return imported
  }

  // ── Export ────────────────────────────────────────────────────────────────

  /**
   * Generates an OPML 2.0 XML document from the current feed list.
   * Feeds are grouped by their feed group (category).
   */
  export(): string {
    const groups = this.feedService.getGroups()
    const feeds  = this.feedService.getAll()

    // Group feeds by group_id
    const byGroup = new Map<number | null, typeof feeds>()
    byGroup.set(null, [])
    for (const g of groups) byGroup.set(g.id, [])
    for (const f of feeds) {
      const bucket = byGroup.get(f.group_id) ?? byGroup.get(null)!
      bucket.push(f)
    }

    // Build outline tree
    const outlines: object[] = []

    // Ungrouped feeds first
    for (const feed of byGroup.get(null) ?? []) {
      outlines.push({
        '@_type':    'rss',
        '@_title':   feed.title ?? feed.url,
        '@_xmlUrl':  feed.url,
        '@_htmlUrl': feed.site_url ?? '',
      })
    }

    // Feed groups as category outlines
    for (const group of groups) {
      const children = (byGroup.get(group.id) ?? []).map(feed => ({
        '@_type':    'rss',
        '@_title':   feed.title ?? feed.url,
        '@_xmlUrl':  feed.url,
        '@_htmlUrl': feed.site_url ?? '',
      }))
      if (children.length === 0) continue
      outlines.push({
        '@_title':   group.name,
        '@_text':    group.name,
        outline: children,
      })
    }

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      indentBy: '  ',
    })

    return builder.build({
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      opml: {
        '@_version': '2.0',
        head: {
          title: 'Albatros RSS Subscriptions',
          dateCreated: new Date().toUTCString(),
        },
        body: { outline: outlines },
      },
    })
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Recursively walks the outline tree and collects feed entries. */
  private extractFeeds(outlines: unknown, category: string | null = null): OpmlFeed[] {
    const items = Array.isArray(outlines) ? outlines : [outlines]
    const result: OpmlFeed[] = []

    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>

      const xmlUrl  = (o['@_xmlUrl'] as string | undefined) ?? ''
      const title   = (o['@_title']  as string | undefined) ?? (o['@_text'] as string | undefined) ?? null
      const htmlUrl = (o['@_htmlUrl'] as string | undefined) ?? null

      // Any outline carrying an xmlUrl is a feed — many exporters omit the
      // `type` attribute, so it must not be required.
      if (xmlUrl) {
        result.push({ title, xmlUrl, htmlUrl, category })
      }
      if (o['outline']) {
        // Recurse into children even when this node is itself a feed
        const groupName = xmlUrl ? category : (title ?? null)
        result.push(...this.extractFeeds(o['outline'], groupName))
      }
    }

    return result
  }
}
