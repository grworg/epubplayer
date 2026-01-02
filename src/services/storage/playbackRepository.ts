import { db, type PlaybackState } from './db'

// ============================================================================
// Playback State Repository
// ============================================================================

export const playbackRepository = {
  /**
   * Get playback state for a book
   */
  async get(bookId: string): Promise<PlaybackState | undefined> {
    return await db.playbackStates.get(bookId)
  },

  /**
   * Save or update playback state
   */
  async save(state: Omit<PlaybackState, 'updatedAt'>): Promise<void> {
    await db.playbackStates.put({
      ...state,
      updatedAt: new Date(),
    })
  },

  /**
   * Update position only (most frequent operation)
   */
  async updatePosition(
    bookId: string,
    sectionIndex: number,
    chunkIndex: number,
    timeInChunk: number
  ): Promise<void> {
    const existing = await db.playbackStates.get(bookId)
    if (existing) {
      await db.playbackStates.update(bookId, {
        sectionIndex,
        chunkIndex,
        timeInChunk,
        updatedAt: new Date(),
      })
    }
  },

  /**
   * Update playback settings (speed, voice, model)
   */
  async updateSettings(
    bookId: string,
    settings: { speed?: number; voiceId?: string; modelConfig?: string }
  ): Promise<void> {
    const existing = await db.playbackStates.get(bookId)
    if (existing) {
      await db.playbackStates.update(bookId, {
        ...settings,
        updatedAt: new Date(),
      })
    }
  },

  /**
   * Delete playback state for a book
   */
  async delete(bookId: string): Promise<void> {
    await db.playbackStates.delete(bookId)
  },

  /**
   * Get all playback states (for sync/export)
   */
  async getAll(): Promise<PlaybackState[]> {
    return await db.playbackStates.toArray()
  },

  /**
   * Create initial playback state for a new book
   */
  async initialize(bookId: string, voiceId: string, modelConfig: string): Promise<void> {
    const existing = await db.playbackStates.get(bookId)
    if (!existing) {
      await db.playbackStates.add({
        bookId,
        sectionIndex: 0,
        chunkIndex: 0,
        timeInChunk: 0,
        speed: 1.0,
        voiceId,
        modelConfig,
        updatedAt: new Date(),
      })
    }
  },
}
