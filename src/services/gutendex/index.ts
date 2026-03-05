/**
 * Gutendex API Client
 *
 * Thin wrapper around the public Gutendex API (gutendex.com) for
 * searching and browsing Project Gutenberg metadata. All responses
 * are cached in-memory with LRU eviction and a 1-hour TTL to avoid
 * redundant network calls during a session.
 *
 * EPUB file downloads go through the CORS proxy since gutenberg.org
 * doesn't set Access-Control-Allow-Origin headers. The Gutendex API
 * itself and cover images work without a proxy.
 */

import { createLogger } from '@/services/logging'

const log = createLogger('gutendex')

// ============================================================================
// Types
// ============================================================================

export interface GutenbergAuthor {
  name: string
  birth_year: number | null
  death_year: number | null
}

export interface GutenbergBook {
  id: number
  title: string
  authors: GutenbergAuthor[]
  subjects: string[]
  bookshelves: string[]
  languages: string[]
  copyright: boolean | null
  media_type: string
  formats: Record<string, string>
  download_count: number
}

export interface GutenbergSearchResult {
  count: number
  next: string | null
  previous: string | null
  results: GutenbergBook[]
}

export interface SearchOptions {
  page?: number
  languages?: string
}

// ============================================================================
// Constants
// ============================================================================

const BASE_URL = 'https://gutendex.com'
const CORS_PROXY_URL = 'https://proxy.grassrootswork.org'

const CACHE_MAX_ENTRIES = 100
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

// ============================================================================
// LRU Cache
// ============================================================================

interface CacheEntry<T> {
  data: T
  timestamp: number
}

const cache = new Map<string, CacheEntry<unknown>>()

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null

  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }

  // Move to end (most recently used)
  cache.delete(key)
  cache.set(key, entry)
  return entry.data as T
}

function cacheSet<T>(key: string, data: T): void {
  // Evict oldest if at capacity
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { data, timestamp: Date.now() })
}

// ============================================================================
// Fetch Helper
// ============================================================================

async function fetchGutendex<T>(url: string): Promise<T> {
  const cached = cacheGet<T>(url)
  if (cached) {
    log.debug('Cache hit', { url })
    return cached
  }

  log.info('Fetching', { url })
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Gutendex API error: ${res.status} ${res.statusText}`)
  }

  const data: T = await res.json()
  cacheSet(url, data)
  return data
}

// ============================================================================
// Public API
// ============================================================================

export function searchBooks(
  query: string,
  options: SearchOptions = {},
): Promise<GutenbergSearchResult> {
  const params = new URLSearchParams({ search: query })
  if (options.languages) params.set('languages', options.languages)
  if (options.page && options.page > 1) params.set('page', String(options.page))
  return fetchGutendex(`${BASE_URL}/books?${params}`)
}

export function getPopularBooks(
  page = 1,
  languages = 'en',
): Promise<GutenbergSearchResult> {
  const params = new URLSearchParams({
    languages,
    sort: 'popular',
  })
  if (page > 1) params.set('page', String(page))
  return fetchGutendex(`${BASE_URL}/books?${params}`)
}

export function getBooksByTopic(
  topic: string,
  page = 1,
  languages = 'en',
): Promise<GutenbergSearchResult> {
  const params = new URLSearchParams({
    topic,
    languages,
    sort: 'popular',
  })
  if (page > 1) params.set('page', String(page))
  return fetchGutendex(`${BASE_URL}/books?${params}`)
}

export function getBook(id: number): Promise<GutenbergBook> {
  return fetchGutendex(`${BASE_URL}/books/${id}`)
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the best EPUB download URL from a book's formats.
 * Prefers epub3 with images, falls back to epub with images, then plain epub.
 */
export function getEpubUrl(book: GutenbergBook): string | null {
  return (
    book.formats['application/epub+zip'] ||
    null
  )
}

/**
 * Get the cover image URL (no proxy needed for <img> tags).
 */
export function getCoverUrl(book: GutenbergBook): string | null {
  return (
    book.formats['image/jpeg'] ||
    null
  )
}

/**
 * Wrap a Gutenberg download URL with the CORS proxy.
 */
export function proxyUrl(url: string): string {
  return `${CORS_PROXY_URL}/${url}`
}

/**
 * Format author display string.
 */
export function formatAuthors(authors: GutenbergAuthor[]): string {
  if (authors.length === 0) return 'Unknown'
  return authors.map((a) => a.name).join(', ')
}

/**
 * Format download count for display (e.g. "12.3k").
 */
export function formatDownloadCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}
