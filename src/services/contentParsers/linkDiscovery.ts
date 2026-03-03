/**
 * Link Discovery
 *
 * Analyzes a web page's HTML to find sibling/TOC pages that form
 * a multi-page document (e.g., a book split across URLs).
 *
 * Heuristics:
 * 1. Find <nav> or TOC-like containers with lists of links
 * 2. Filter to links sharing a common URL prefix with the source page
 * 3. Exclude external links, anchors, and non-content patterns
 * 4. Return ordered, deduplicated list for user confirmation
 */

import { createLogger } from '@/services/logging'

const log = createLogger('import')

// ============================================================================
// Types
// ============================================================================

export interface DiscoveredPage {
  url: string
  title: string
  /** Whether this is the page the user originally submitted */
  isCurrent: boolean
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Discover sibling pages from an HTML document.
 * Returns empty array if no multi-page structure is detected.
 */
export function discoverLinkedPages(
  html: string,
  sourceUrl: string,
): DiscoveredPage[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  let sourceUrlObj: URL
  try {
    sourceUrlObj = new URL(sourceUrl)
  } catch {
    return []
  }

  // Compute the common path prefix (e.g., "/read/full/" from "/read/full/introduction")
  const pathParts = sourceUrlObj.pathname.split('/').filter(Boolean)
  if (pathParts.length < 2) return []

  const parentPath = '/' + pathParts.slice(0, -1).join('/') + '/'

  // Strategy 1: Look for links in nav, aside, or TOC-like containers
  const candidates = findNavigationLinks(doc, sourceUrlObj, parentPath)

  if (candidates.length < 2) {
    // Strategy 2: Broader search — all same-prefix links on the page
    const broader = findAllSiblingLinks(doc, sourceUrlObj, parentPath)
    if (broader.length < 2) return []
    return deduplicateAndOrder(broader, sourceUrl)
  }

  return deduplicateAndOrder(candidates, sourceUrl)
}

// ============================================================================
// Link Finding Strategies
// ============================================================================

const NAV_SELECTORS = [
  'nav',
  '[role="navigation"]',
  '.toc',
  '.table-of-contents',
  '#toc',
  '#table-of-contents',
  '.sidebar',
  '.nav-menu',
  '.chapter-list',
  '.chapters',
  '.book-nav',
  '.reading-nav',
]

function findNavigationLinks(
  doc: Document,
  sourceUrl: URL,
  parentPath: string,
): DiscoveredPage[] {
  const pages: DiscoveredPage[] = []

  for (const selector of NAV_SELECTORS) {
    const containers = doc.querySelectorAll(selector)
    for (const container of containers) {
      const links = container.querySelectorAll('a[href]')
      for (const link of links) {
        const page = evaluateLink(link as HTMLAnchorElement, sourceUrl, parentPath)
        if (page) pages.push(page)
      }
    }
    if (pages.length >= 2) break
  }

  return pages
}

function findAllSiblingLinks(
  doc: Document,
  sourceUrl: URL,
  parentPath: string,
): DiscoveredPage[] {
  const pages: DiscoveredPage[] = []
  const links = doc.querySelectorAll('a[href]')

  for (const link of links) {
    const page = evaluateLink(link as HTMLAnchorElement, sourceUrl, parentPath)
    if (page) pages.push(page)
  }

  return pages
}

function evaluateLink(
  anchor: HTMLAnchorElement,
  sourceUrl: URL,
  parentPath: string,
): DiscoveredPage | null {
  const href = anchor.getAttribute('href')
  if (!href) return null

  let resolved: URL
  try {
    resolved = new URL(href, sourceUrl.origin)
  } catch {
    return null
  }

  // Must be same origin
  if (resolved.origin !== sourceUrl.origin) return null

  // Must share the parent path prefix
  if (!resolved.pathname.startsWith(parentPath)) return null

  // Must be a deeper path (not the parent itself)
  const remainder = resolved.pathname.slice(parentPath.length)
  if (!remainder || remainder.includes('/')) return null

  // Skip anchors-only links and common non-content paths
  if (href.startsWith('#')) return null
  const lower = resolved.pathname.toLowerCase()
  if (SKIP_PATTERNS.some((p) => lower.includes(p))) return null

  const title =
    anchor.textContent?.trim() ||
    prettifySlug(remainder)

  return {
    url: resolved.origin + resolved.pathname,
    title,
    isCurrent: resolved.pathname === sourceUrl.pathname,
  }
}

// ============================================================================
// Helpers
// ============================================================================

const SKIP_PATTERNS = [
  '/login', '/signup', '/register', '/account', '/cart',
  '/search', '/contact', '/about', '/privacy', '/terms',
  '/feed', '/rss', '/api/',
]

function deduplicateAndOrder(
  pages: DiscoveredPage[],
  sourceUrl: string,
): DiscoveredPage[] {
  const seen = new Map<string, DiscoveredPage>()
  for (const page of pages) {
    if (!seen.has(page.url)) {
      seen.set(page.url, {
        ...page,
        isCurrent: page.url === sourceUrl || page.url === sourceUrl.replace(/\/$/, ''),
      })
    }
  }

  const result = Array.from(seen.values())

  log.info('Discovered sibling pages', {
    count: result.length,
    sourceUrl,
  })

  return result
}

function prettifySlug(slug: string): string {
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\.\w+$/, '')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
