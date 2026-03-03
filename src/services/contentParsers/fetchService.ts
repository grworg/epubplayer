/**
 * Fetch Service
 *
 * Cascading strategy for fetching arbitrary URLs from the browser:
 * 1. Direct fetch (works for CORS-friendly sites)
 * 2. Public CORS proxy (allorigins.win by default, configurable)
 * 3. Jina Reader (headless browser rendering for JS-heavy sites)
 * 4. Reports failure so UI can suggest paste fallback
 *
 * The proxy URL is stored in settings, so users can swap it without code changes.
 */

import { createLogger } from '@/services/logging'
import { settingsRepository } from '@/services/storage/settingsRepository'

const log = createLogger('import')

const JINA_READER_BASE = 'https://r.jina.ai/'

// ============================================================================
// Types
// ============================================================================

export type FetchStrategy = 'direct' | 'proxy' | 'reader'

export interface FetchResult {
  html: string
  strategy: FetchStrategy
  finalUrl: string
}

/**
 * Content extracted by a reader/rendering service (e.g. Jina Reader).
 * Already cleaned — no need for Readability post-processing.
 */
export interface RenderedContent {
  title: string
  text: string
  description?: string
  url: string
}

export class FetchError extends Error {
  readonly triedStrategies: FetchStrategy[]

  constructor(message: string, triedStrategies: FetchStrategy[]) {
    super(message)
    this.name = 'FetchError'
    this.triedStrategies = triedStrategies
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch HTML from a URL using cascading strategies.
 * Throws FetchError if all strategies fail.
 */
export async function fetchUrl(url: string): Promise<FetchResult> {
  const normalizedUrl = normalizeUrl(url)
  const tried: FetchStrategy[] = []

  // Strategy 1: Direct fetch
  tried.push('direct')
  const directResult = await tryDirectFetch(normalizedUrl)
  if (directResult) {
    log.info('Direct fetch succeeded', { url: normalizedUrl })
    return { html: directResult, strategy: 'direct', finalUrl: normalizedUrl }
  }

  // Strategy 2: CORS proxy
  tried.push('proxy')
  const proxyResult = await tryProxyFetch(normalizedUrl)
  if (proxyResult) {
    log.info('Proxy fetch succeeded', { url: normalizedUrl })
    return { html: proxyResult, strategy: 'proxy', finalUrl: normalizedUrl }
  }

  // All strategies failed
  log.warn('All fetch strategies failed', { url: normalizedUrl, tried })
  throw new FetchError(
    'Could not fetch this URL. The site may block external access.',
    tried,
  )
}

// ============================================================================
// Strategies
// ============================================================================

async function tryDirectFetch(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml' },
    })
    clearTimeout(timeout)

    if (!response.ok) return null

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('xhtml')) {
      return null
    }

    return await response.text()
  } catch {
    log.debug('Direct fetch failed (expected for most sites)')
    return null
  }
}

async function tryProxyFetch(url: string): Promise<string | null> {
  const proxyBaseUrl = await settingsRepository.get('corsProxyUrl')

  // Strategy 2a: Try the raw proxy endpoint
  const rawResult = await fetchViaProxy(
    `${proxyBaseUrl}${encodeURIComponent(url)}`,
    'raw',
  )
  if (rawResult) return rawResult

  // Strategy 2b: Try allorigins JSON endpoint as fallback
  // (sometimes the raw endpoint fails but JSON works)
  if (proxyBaseUrl.includes('allorigins.win')) {
    const jsonUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
    const jsonResult = await fetchViaProxy(jsonUrl, 'json')
    if (jsonResult) return jsonResult
  }

  return null
}

async function fetchViaProxy(
  proxyUrl: string,
  mode: 'raw' | 'json',
): Promise<string | null> {
  try {
    log.debug('Trying proxy fetch', { proxyUrl: proxyUrl.substring(0, 80), mode })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25_000)

    const response = await fetch(proxyUrl, { signal: controller.signal })
    clearTimeout(timeout)

    if (!response.ok) return null

    if (mode === 'json') {
      const json = await response.json()
      const contents = json?.contents
      if (typeof contents === 'string' && contents.length > 100) return contents
      return null
    }

    const text = await response.text()
    if (!text || text.length < 100) return null

    return text
  } catch (error) {
    log.debug('Proxy fetch failed', {
      mode,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// ============================================================================
// Jina Reader (JS-rendered content extraction)
// ============================================================================

/**
 * Fetch rendered content via Jina Reader API.
 * Jina runs a headless browser, so it handles JS-rendered pages.
 * Returns structured content (title + clean text) or null on failure.
 */
export async function fetchRenderedContent(url: string): Promise<RenderedContent | null> {
  const normalizedUrl = normalizeUrl(url)

  try {
    log.debug('Trying Jina Reader', { url: normalizedUrl })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45_000)

    const response = await fetch(`${JINA_READER_BASE}${normalizedUrl}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    })
    clearTimeout(timeout)

    if (!response.ok) {
      log.debug('Jina Reader returned non-OK', { status: response.status })
      return null
    }

    const json = await response.json()
    const data = json?.data
    if (!data?.content || typeof data.content !== 'string') {
      log.debug('Jina Reader returned no content')
      return null
    }

    const text = data.content.trim()
    if (text.length < 200) {
      log.debug('Jina Reader returned too little content', { length: text.length })
      return null
    }

    log.info('Jina Reader succeeded', {
      title: data.title,
      contentLength: text.length,
    })

    return {
      title: data.title || '',
      text,
      description: data.description || undefined,
      url: data.url || normalizedUrl,
    }
  } catch (error) {
    log.debug('Jina Reader failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeUrl(url: string): string {
  let normalized = url.trim()
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = 'https://' + normalized
  }
  return normalized
}
