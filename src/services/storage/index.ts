// Re-export all storage modules for convenient imports
export { db, hashText, hashBlob, sectionId, audioChunkId } from './db'
export type { Book, Section, PlaybackState, AudioChunk, Bookmark, Settings } from './db'

export { bookRepository, sectionRepository } from './bookRepository'
export { playbackRepository } from './playbackRepository'
export { audioChunkRepository } from './audioChunkRepository'
export { bookmarkRepository } from './bookmarkRepository'
export { settingsRepository, DEFAULT_SETTINGS } from './settingsRepository'
export type { SettingKey, SettingValue } from './settingsRepository'

// ============================================================================
// Storage Statistics
// ============================================================================

import { db } from './db'
import { audioChunkRepository } from './audioChunkRepository'

export const storageStats = {
  /**
   * Get storage usage statistics
   */
  async getStats() {
    const [bookCount, audioSize, chunkCount] = await Promise.all([
      db.books.count(),
      audioChunkRepository.getTotalSize(),
      db.audioChunks.count(),
    ])

    // Get browser storage estimate if available
    let quotaUsed = 0
    let quotaTotal = 0
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate()
      quotaUsed = estimate.usage ?? 0
      quotaTotal = estimate.quota ?? 0
    }

    return {
      bookCount,
      audioSize,
      audioSizeMB: Math.round((audioSize / 1024 / 1024) * 10) / 10,
      chunkCount,
      quotaUsed,
      quotaUsedMB: Math.round(quotaUsed / 1024 / 1024),
      quotaTotal,
      quotaTotalMB: Math.round(quotaTotal / 1024 / 1024),
      quotaPercentUsed: quotaTotal > 0 ? Math.round((quotaUsed / quotaTotal) * 100) : 0,
    }
  },

  /**
   * Get per-book storage breakdown
   */
  async getBookStats(bookId: string) {
    const [audioSize, chunkCount, bookmarkCount] = await Promise.all([
      audioChunkRepository.getSizeForBook(bookId),
      audioChunkRepository.countForBook(bookId),
      db.bookmarks.where('bookId').equals(bookId).count(),
    ])

    return {
      audioSize,
      audioSizeMB: Math.round((audioSize / 1024 / 1024) * 10) / 10,
      chunkCount,
      bookmarkCount,
    }
  },

  /**
   * Clear all cached audio (keeps books and sections)
   */
  async clearAllAudio(): Promise<void> {
    await db.audioChunks.clear()
  },

  /**
   * Clear all data (full reset)
   */
  async clearAll(): Promise<void> {
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) {
        await table.clear()
      }
    })
  },
}
