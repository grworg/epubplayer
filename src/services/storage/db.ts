import Dexie, { type EntityTable } from 'dexie'

// ============================================================================
// Type definitions for all stored entities
// ============================================================================

export interface Book {
  id: string
  title: string
  author: string
  coverBlob?: Blob
  coverUrl?: string // Object URL, generated at runtime
  epubBlob?: Blob // Original EPUB file for export/download
  contentHash?: string // SHA-256 hash of EPUB content for deduplication
  language?: string
  publisher?: string
  description?: string
  totalSections: number
  addedAt: Date
  lastPlayedAt?: Date
}

export interface Section {
  id: string // Composite: `${bookId}:${index}`
  bookId: string
  index: number
  title: string
  href: string // Original href in EPUB
  textContent: string // Normalized plain text for TTS
  textHash: string // Hash of textContent for cache key
  charCount: number
  estimatedDuration: number // Estimated TTS duration in seconds
}

export interface PlaybackState {
  bookId: string // Primary key
  sectionIndex: number
  chunkIndex: number
  timeInChunk: number // Seconds into the current chunk
  speed: number
  voiceId: string
  modelConfig: string // e.g., "q8" or "fp32"
  updatedAt: Date
}

export interface AudioChunk {
  id: string // Composite: `${bookId}:${sectionIndex}:${chunkIndex}:${voiceId}:${modelConfig}:${textHash}`
  bookId: string
  sectionIndex: number
  chunkIndex: number
  voiceId: string
  modelConfig: string
  textHash: string
  audioBlob: Blob
  duration: number // Seconds
  createdAt: Date
}

export interface Bookmark {
  id: string
  bookId: string
  sectionIndex: number
  chunkIndex: number
  timeInChunk: number
  note?: string
  createdAt: Date
}

export interface Settings {
  key: string // Primary key, e.g., "voice", "quality", "bufferMinutes"
  value: string | number | boolean
}

// ============================================================================
// Database class
// ============================================================================

class EPUBPlayerDB extends Dexie {
  books!: EntityTable<Book, 'id'>
  sections!: EntityTable<Section, 'id'>
  playbackStates!: EntityTable<PlaybackState, 'bookId'>
  audioChunks!: EntityTable<AudioChunk, 'id'>
  bookmarks!: EntityTable<Bookmark, 'id'>
  settings!: EntityTable<Settings, 'key'>

  constructor() {
    super('epub-player')

    this.version(1).stores({
      books: 'id, title, author, addedAt, lastPlayedAt',
      sections: 'id, bookId, index, [bookId+index]',
      playbackStates: 'bookId, updatedAt',
      audioChunks: 'id, bookId, [bookId+sectionIndex+chunkIndex], createdAt',
      bookmarks: 'id, bookId, createdAt',
      settings: 'key',
    })

    // v2: Add compound index for global text-hash cache lookup
    // This enables finding cached audio by text content regardless of book/position
    this.version(2).stores({
      books: 'id, title, author, addedAt, lastPlayedAt',
      sections: 'id, bookId, index, [bookId+index]',
      playbackStates: 'bookId, updatedAt',
      audioChunks: 'id, bookId, [bookId+sectionIndex+chunkIndex], [textHash+voiceId+modelConfig], createdAt',
      bookmarks: 'id, bookId, createdAt',
      settings: 'key',
    })

    // v3: Add contentHash to books for P2P transfer deduplication
    this.version(3).stores({
      books: 'id, title, author, addedAt, lastPlayedAt, contentHash',
      sections: 'id, bookId, index, [bookId+index]',
      playbackStates: 'bookId, updatedAt',
      audioChunks: 'id, bookId, [bookId+sectionIndex+chunkIndex], [textHash+voiceId+modelConfig], createdAt',
      bookmarks: 'id, bookId, createdAt',
      settings: 'key',
    })
  }
}

// Singleton database instance
export const db = new EPUBPlayerDB()

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Generate a hash for text content (for cache key)
 */
export async function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate a hash for a Blob (for EPUB deduplication)
 * Uses SHA-256 and returns first 16 hex chars for a good balance of uniqueness and brevity
 */
export async function hashBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate composite ID for a section
 */
export function sectionId(bookId: string, index: number): string {
  return `${bookId}:${index}`
}

/**
 * Generate composite ID for an audio chunk
 */
export function audioChunkId(
  bookId: string,
  sectionIndex: number,
  chunkIndex: number,
  voiceId: string,
  modelConfig: string,
  textHash: string
): string {
  return `${bookId}:${sectionIndex}:${chunkIndex}:${voiceId}:${modelConfig}:${textHash}`
}
