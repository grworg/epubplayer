/**
 * Fetch Service
 *
 * Cascading strategy for fetching arbitrary URLs from the browser:
 * 1. Direct fetch (works for CORS-friendly sites)
 * 2. Public CORS proxy (allorigins.win by default, configurable)
 * 3. Reports failure so UI can suggest paste fallback
 *
 * The proxy URL is stored in settings, so users can swap it without code changes.
 */

import { createLogger } from '@/services/logging'
import { settingsRepository } from '@/services/storage/settingsRepository'

const log = createLogger('import')

// ============================================================================
// Types
// ============================================================================

export type FetchStrategy = 'direct' | 'proxy'

export interface FetchResult {
  html: string
  strategy: FetchStrategy
  finalUrl: string
}

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly triedStrategies: FetchStrategy[],
  ) {
    super(message)
    this.name = 'FetchError'
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
  try {
    const proxyBaseUrl = await settingsRepository.get('corsProxyUrl')
    const proxyUrl = `${proxyBaseUrl}${encodeURIComponent(url)}`

    log.debug('Trying proxy fetch', { proxy: proxyBaseUrl })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    const response = await fetch(proxyUrl, { signal: controller.signal })
    clearTimeout(timeout)

    if (!response.ok) return null

    const text = await response.text()
    if (!text || text.length < 100) return null

    return text
  } catch (error) {
    log.debug('Proxy fetch failed', {
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
