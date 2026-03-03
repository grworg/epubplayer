/**
 * Web/URL Parser
 *
 * Fetches a URL, extracts article content using Mozilla Readability,
 * and produces ParsedContent for the shared import pipeline.
 */

import { Readability } from '@mozilla/readability'
import { createLogger } from '@/services/logging'
import { hashText } from '@/services/storage/db'
import { fetchUrl, fetchRenderedContent, FetchError } from './fetchService'
import { detectSectionsFromHtml, detectSectionsFromPlainText } from './sectionDetector'
import { discoverLinkedPages, type DiscoveredPage } from './linkDiscovery'
import type { ParsedContent, DetectedSection, ImportProgressCallback, HtmlBlock } from './types'

const log = createLogger('import')

/**
 * Thrown when Readability extracts too little text.
 * The caller can catch this and try Jina Reader as a fallback.
 */
export class ThinContentError extends Error {
  constructor(public readonly extractedChars: number) {
    super(
      'Very little text was extracted. The site may use JavaScript to load content.',
    )
    this.name = 'ThinContentError'
  }
}

// ============================================================================
// Public API
// ============================================================================

export interface WebParseOptions {
  onProgress?: ImportProgressCallback
}

/**
 * Parse a web URL into ParsedContent.
 * Throws FetchError if the URL cannot be reached (UI should suggest paste fallback).
 */
export async function parseWebUrl(
  url: string,
  options: WebParseOptions = {},
): Promise<ParsedContent> {
  const { onProgress } = options

  onProgress?.('Fetching page...', 10)
  log.info('Fetching URL', { url })

  let html: string
  try {
    const result = await fetchUrl(url)
    html = result.html
    log.info('Page fetched', { strategy: result.strategy, htmlLength: html.length })
  } catch (error) {
    if (error instanceof FetchError) throw error
    throw new FetchError('Failed to fetch URL', ['direct', 'proxy'])
  }

  onProgress?.('Extracting article...', 50)
  return parseHtmlContent(html, url, onProgress)
}

/**
 * Parse raw HTML string into ParsedContent.
 * Used by both URL fetch and paste-HTML flows.
 */
export async function parseHtmlContent(
  html: string,
  sourceUrl?: string,
  onProgress?: ImportProgressCallback,
): Promise<ParsedContent> {
  // Parse HTML into a DOM document
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  // Run Readability to extract article content
  const article = new Readability(doc, { charThreshold: 50 }).parse()

  if (!article || !article.textContent?.trim()) {
    throw new ThinContentError(0)
  }

  const MIN_USEFUL_CONTENT = 500
  if (article.textContent.trim().length < MIN_USEFUL_CONTENT) {
    throw new ThinContentError(article.textContent.trim().length)
  }

  log.info('Article extracted', {
    title: article.title,
    author: article.byline,
    contentLength: article.textContent.length,
  })

  onProgress?.('Detecting sections...', 70)
  const htmlBlocks = extractHtmlBlocks(article.content)
  const title = article.title || extractTitleFromUrl(sourceUrl) || 'Untitled'
  const sections = detectSectionsFromHtml(htmlBlocks, title)
  const contentHash = await hashText(article.textContent)

  onProgress?.('Done', 100)

  return {
    metadata: {
      title,
      author: article.byline || 'Unknown Author',
      description: article.excerpt || undefined,
      sourceType: 'web',
      sourceUrl,
    },
    sections,
    contentHash,
  }
}

// ============================================================================
// Jina Reader Content Builder
// ============================================================================

/**
 * Build ParsedContent from Jina Reader output (markdown text).
 * Jina already extracts the article, so we just need section detection.
 */
async function buildFromRendered(
  rendered: { title: string; text: string; description?: string; url: string },
  sourceUrl: string,
  onProgress?: ImportProgressCallback,
): Promise<ParsedContent> {
  log.info('Building from rendered content', {
    title: rendered.title,
    contentLength: rendered.text.length,
  })

  onProgress?.('Detecting sections...', 80)
  const title = rendered.title || extractTitleFromUrl(sourceUrl) || 'Untitled'
  const sections = detectSectionsFromPlainText(rendered.text, title)
  const contentHash = await hashText(rendered.text)

  onProgress?.('Done', 100)

  return {
    metadata: {
      title,
      author: 'Unknown Author',
      description: rendered.description,
      sourceType: 'web',
      sourceUrl,
    },
    sections,
    contentHash,
  }
}

/**
 * Parse a URL using Jina Reader directly (bypasses fetch + Readability).
 * Use this as a fallback when normal fetching fails entirely.
 */
export async function parseUrlWithReader(
  url: string,
  onProgress?: ImportProgressCallback,
): Promise<ParsedContent> {
  onProgress?.('Trying reader service...', 30)

  const rendered = await fetchRenderedContent(url)
  if (!rendered || rendered.text.length < 200) {
    throw new Error(
      'Could not extract content from this page. The site may block all external access. Try pasting the article text instead.',
    )
  }

  return buildFromRendered(rendered, url, onProgress)
}

// ============================================================================
// Multi-Page Support
// ============================================================================

/**
 * Discover sibling pages linked from the given HTML.
 * Returns an empty array if no multi-page structure is detected.
 */
export function discoverPages(html: string, sourceUrl: string): DiscoveredPage[] {
  return discoverLinkedPages(html, sourceUrl)
}

/**
 * Fetch a URL and return both the HTML and any discovered sibling pages.
 * This is the first step of the URL import flow — the UI can then
 * ask the user which pages to include before parsing.
 */
export async function fetchAndDiscover(
  url: string,
  onProgress?: ImportProgressCallback,
): Promise<{ html: string; finalUrl: string; pages: DiscoveredPage[] }> {
  onProgress?.('Fetching page...', 10)

  const result = await fetchUrl(url)
  const pages = discoverLinkedPages(result.html, url)

  log.info('Fetch + discover complete', {
    url,
    strategy: result.strategy,
    discoveredPages: pages.length,
  })

  return { html: result.html, finalUrl: result.finalUrl, pages }
}

/**
 * Parse multiple URLs into a single ParsedContent.
 * Each URL becomes one section/chapter.
 */
export async function parseMultiPageWebsite(
  pages: { url: string; title: string }[],
  options: WebParseOptions = {},
): Promise<ParsedContent> {
  const { onProgress } = options

  log.info('Parsing multi-page site', { pages: pages.length })

  const sections: DetectedSection[] = []
  const allText: string[] = []
  let siteTitle = ''
  let siteAuthor = ''

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    const pct = Math.round(((i + 1) / pages.length) * 80) + 10
    onProgress?.(`Fetching page ${i + 1} of ${pages.length}...`, pct)

    try {
      const result = await fetchUrl(page.url)
      const parser = new DOMParser()
      const doc = parser.parseFromString(result.html, 'text/html')
      const article = new Readability(doc, { charThreshold: 50 }).parse()

      if (article?.textContent?.trim()) {
        const text = article.textContent.replace(/\s+/g, ' ').trim()
        sections.push({
          title: page.title || article.title || `Page ${i + 1}`,
          textContent: text,
          confidence: 'high',
        })
        allText.push(text)

        // Use the first page's metadata as the book metadata
        if (i === 0) {
          siteTitle = article.title || ''
          siteAuthor = article.byline || ''
        }
      } else {
        log.warn('No content extracted from page', { url: page.url })
      }
    } catch (error) {
      log.warn('Failed to fetch page, skipping', {
        url: page.url,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (sections.length === 0) {
    throw new Error('No readable content found on any of the selected pages')
  }

  const combinedText = allText.join(' ')
  const contentHash = await hashText(combinedText)

  // Try to derive a better title from the site structure
  const firstUrl = pages[0]?.url
  const bookTitle = siteTitle || extractSiteTitleFromUrl(firstUrl) || 'Untitled'

  onProgress?.('Done', 100)

  return {
    metadata: {
      title: bookTitle,
      author: siteAuthor || 'Unknown Author',
      sourceType: 'web',
      sourceUrl: firstUrl,
    },
    sections,
    contentHash,
  }
}

function extractSiteTitleFromUrl(url?: string): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    // Use the parent path as the title (e.g., "/read/full" → "Read Full")
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.length >= 2) {
      return parts
        .slice(0, -1)
        .map((p) => p.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
        .join(' — ')
    }
    return parsed.hostname
  } catch {
    return null
  }
}

// ============================================================================
// HTML Block Extraction
// ============================================================================

/**
 * Walk article HTML and produce a flat list of blocks with tag info.
 * This preserves heading structure for the section detector.
 */
function extractHtmlBlocks(html: string): HtmlBlock[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(
    `<div>${html}</div>`,
    'text/html',
  )
  const root = doc.body.firstElementChild
  if (!root) return []

  const blocks: HtmlBlock[] = []
  const headingTags = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
  const blockTags = new Set([
    'P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI',
    'PRE', 'FIGCAPTION', 'TD', 'TH',
  ])

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim()
      if (text) {
        blocks.push({ tagName: 'P', textContent: text })
      }
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element

    // Skip non-content elements
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'FIGURE'].includes(el.tagName)) {
      return
    }

    if (headingTags.has(el.tagName)) {
      const text = el.textContent?.trim()
      if (text) {
        blocks.push({ tagName: el.tagName, textContent: text })
      }
      return
    }

    if (blockTags.has(el.tagName)) {
      const text = el.textContent?.trim()
      if (text) {
        blocks.push({ tagName: el.tagName, textContent: text })
      }
      return
    }

    // For other elements, walk children
    for (const child of el.childNodes) {
      walk(child)
    }
  }

  walk(root)
  return blocks
}

// ============================================================================
// Helpers
// ============================================================================

function extractTitleFromUrl(url?: string): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const pathParts = parsed.pathname.split('/').filter(Boolean)
    const lastPart = pathParts[pathParts.length - 1]
    if (lastPart) {
      return lastPart
        .replace(/[-_]/g, ' ')
        .replace(/\.\w+$/, '')
        .replace(/\b\w/g, (c) => c.toUpperCase())
    }
    return parsed.hostname
  } catch {
    return null
  }
}
