import { db, type AudioChunk, audioChunkId } from './db'

// ============================================================================
// Audio Chunk Repository
// ============================================================================

export const audioChunkRepository = {
  /**
   * Get a specific audio chunk by its components (position-specific lookup)
   */
  async get(
    bookId: string,
    sectionIndex: number,
    chunkIndex: number,
    voiceId: string,
    modelConfig: string,
    textHash: string
  ): Promise<AudioChunk | undefined> {
    const id = audioChunkId(bookId, sectionIndex, chunkIndex, voiceId, modelConfig, textHash)
    return await db.audioChunks.get(id)
  },

  /**
   * Get audio chunk by text hash only (global deduplication lookup).
   * This finds cached audio for the same text regardless of book/position.
   * Useful when:
   * - User re-imports a book (positions may change)
   * - Same text appears in multiple places
   * - Buffered audio should persist across sessions
   */
  async getByTextHash(
    textHash: string,
    voiceId: string,
    modelConfig: string
  ): Promise<AudioChunk | undefined> {
    // Use the compound index [textHash+voiceId+modelConfig]
    const chunks = await db.audioChunks
      .where('[textHash+voiceId+modelConfig]')
      .equals([textHash, voiceId, modelConfig])
      .limit(1)
      .toArray()
    return chunks[0]
  },

  /**
   * Get audio chunk with fallback to global text cache.
   * First tries position-specific lookup, then falls back to text-hash-only lookup.
   */
  async getWithFallback(
    bookId: string,
    sectionIndex: number,
    chunkIndex: number,
    voiceId: string,
    modelConfig: string,
    textHash: string
  ): Promise<{ chunk: AudioChunk | undefined; source: 'position' | 'textHash' | 'miss' }> {
    // Try position-specific lookup first
    const positionChunk = await this.get(bookId, sectionIndex, chunkIndex, voiceId, modelConfig, textHash)
    if (positionChunk) {
      return { chunk: positionChunk, source: 'position' }
    }

    // Fall back to global text hash lookup
    const textHashChunk = await this.getByTextHash(textHash, voiceId, modelConfig)
    if (textHashChunk) {
      return { chunk: textHashChunk, source: 'textHash' }
    }

    return { chunk: undefined, source: 'miss' }
  },

  /**
   * Save an audio chunk
   */
  async save(
    bookId: string,
    sectionIndex: number,
    chunkIndex: number,
    voiceId: string,
    modelConfig: string,
    textHash: string,
    audioBlob: Blob,
    duration: number
  ): Promise<string> {
    const id = audioChunkId(bookId, sectionIndex, chunkIndex, voiceId, modelConfig, textHash)
    const chunk: AudioChunk = {
      id,
      bookId,
      sectionIndex,
      chunkIndex,
      voiceId,
      modelConfig,
      textHash,
      audioBlob,
      duration,
      createdAt: new Date(),
    }
    await db.audioChunks.put(chunk)
    return id
  },

  /**
   * Check if a chunk exists in cache
   */
  async exists(
    bookId: string,
    sectionIndex: number,
    chunkIndex: number,
    voiceId: string,
    modelConfig: string,
    textHash: string
  ): Promise<boolean> {
    const id = audioChunkId(bookId, sectionIndex, chunkIndex, voiceId, modelConfig, textHash)
    const count = await db.audioChunks.where('id').equals(id).count()
    return count > 0
  },

  /**
   * Get all chunks for a section (for sequential playback)
   */
  async getForSection(
    bookId: string,
    sectionIndex: number,
    voiceId: string,
    modelConfig: string
  ): Promise<AudioChunk[]> {
    const chunks = await db.audioChunks
      .where('[bookId+sectionIndex+chunkIndex]')
      .between([bookId, sectionIndex, 0], [bookId, sectionIndex, Infinity])
      .toArray()

    // Filter by voice and model config
    return chunks
      .filter((c) => c.voiceId === voiceId && c.modelConfig === modelConfig)
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
  },

  /**
   * Delete all chunks for a book
   */
  async deleteForBook(bookId: string): Promise<number> {
    return await db.audioChunks.where('bookId').equals(bookId).delete()
  },

  /**
   * Delete chunks older than a date (for cache management)
   */
  async deleteOlderThan(date: Date): Promise<number> {
    return await db.audioChunks.where('createdAt').below(date).delete()
  },

  /**
   * Get total size of cached audio for a book
   */
  async getSizeForBook(bookId: string): Promise<number> {
    const chunks = await db.audioChunks.where('bookId').equals(bookId).toArray()
    return chunks.reduce((total, chunk) => total + chunk.audioBlob.size, 0)
  },

  /**
   * Get total size of all cached audio
   */
  async getTotalSize(): Promise<number> {
    const chunks = await db.audioChunks.toArray()
    return chunks.reduce((total, chunk) => total + chunk.audioBlob.size, 0)
  },

  /**
   * Get chunk count for a book
   */
  async countForBook(bookId: string): Promise<number> {
    return await db.audioChunks.where('bookId').equals(bookId).count()
  },
}
