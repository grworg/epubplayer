/**
 * Chunk Manager
 * 
 * Handles text chunking and chunk navigation.
 * Separates chunk logic from playback logic.
 */

import { hashText } from '@/services/storage'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { splitTextIntoChunks } from '@/services/tts/textChunking'

// ============================================================================
// Types
// ============================================================================

export interface ChunkInfo {
  sectionIndex: number
  chunkIndex: number
  text: string
  textHash: string
}

export interface ChunkPosition {
  sectionIndex: number
  chunkIndex: number
}

export interface ChunkStats {
  current: number
  total: number
  progress: number
}

// ============================================================================
// Chunk Manager
// ============================================================================

export class ChunkManager {
  private chunks: ChunkInfo[] = []
  private sectionTexts: Map<number, string> = new Map()

  /**
   * Load text for a section and create chunks
   */
  async loadSection(sectionIndex: number, text: string): Promise<ChunkInfo[]> {
    // Store the raw text
    this.sectionTexts.set(sectionIndex, text)

    // Clear existing chunks for this section
    this.chunks = this.chunks.filter((c) => c.sectionIndex !== sectionIndex)

    // Split into chunks using a pure chunking function + current settings.
    // IMPORTANT: do not depend on TTS initialization state (prevents cache/key mismatches).
    const maxChunkChars = await settingsRepository.get('maxChunkChars')
    const textChunks = splitTextIntoChunks(text, maxChunkChars)

    // Create chunk info objects
    const newChunks: ChunkInfo[] = await Promise.all(
      textChunks.map(async (chunkText, index) => ({
        sectionIndex,
        chunkIndex: index,
        text: chunkText,
        textHash: await hashText(chunkText),
      }))
    )

    // Add to our chunks array
    this.chunks.push(...newChunks)

    console.log(`[ChunkManager] Loaded ${newChunks.length} chunks for section ${sectionIndex}`)

    return newChunks
  }

  /**
   * Get chunk at specific position
   */
  getChunk(position: ChunkPosition): ChunkInfo | undefined {
    return this.chunks.find(
      (c) => c.sectionIndex === position.sectionIndex && c.chunkIndex === position.chunkIndex
    )
  }

  /**
   * Get all chunks for a section
   */
  getSectionChunks(sectionIndex: number): ChunkInfo[] {
    return this.chunks.filter((c) => c.sectionIndex === sectionIndex)
  }

  /**
   * Get chunk count for a section
   */
  getSectionChunkCount(sectionIndex: number): number {
    return this.chunks.filter((c) => c.sectionIndex === sectionIndex).length
  }

  /**
   * Get next chunk position (handles section boundaries)
   */
  getNextPosition(
    current: ChunkPosition,
    totalSections: number
  ): ChunkPosition | null {
    const sectionChunks = this.getSectionChunkCount(current.sectionIndex)
    const nextChunkIndex = current.chunkIndex + 1

    if (nextChunkIndex < sectionChunks) {
      // Next chunk in same section
      return {
        sectionIndex: current.sectionIndex,
        chunkIndex: nextChunkIndex,
      }
    }

    // Move to next section
    const nextSectionIndex = current.sectionIndex + 1
    if (nextSectionIndex < totalSections) {
      return {
        sectionIndex: nextSectionIndex,
        chunkIndex: 0,
      }
    }

    // End of book
    return null
  }

  /**
   * Get previous chunk position (handles section boundaries)
   */
  getPreviousPosition(current: ChunkPosition): ChunkPosition | null {
    if (current.chunkIndex > 0) {
      // Previous chunk in same section
      return {
        sectionIndex: current.sectionIndex,
        chunkIndex: current.chunkIndex - 1,
      }
    }

    if (current.sectionIndex > 0) {
      // Last chunk of previous section
      const prevSectionChunks = this.getSectionChunkCount(current.sectionIndex - 1)
      return {
        sectionIndex: current.sectionIndex - 1,
        chunkIndex: Math.max(0, prevSectionChunks - 1),
      }
    }

    // Beginning of book
    return null
  }

  /**
   * Get statistics for current section
   */
  getStats(position: ChunkPosition): ChunkStats {
    const total = this.getSectionChunkCount(position.sectionIndex)
    const current = position.chunkIndex + 1
    const progress = total > 0 ? (position.chunkIndex / total) * 100 : 0

    return {
      current,
      total,
      progress,
    }
  }

  /**
   * Check if position is valid
   */
  isValidPosition(position: ChunkPosition): boolean {
    const chunk = this.getChunk(position)
    return chunk !== undefined
  }

  /**
   * Get chunks ahead of current position (for buffering)
   */
  getChunksAhead(
    position: ChunkPosition,
    count: number,
    totalSections: number
  ): ChunkInfo[] {
    const result: ChunkInfo[] = []
    let currentPos: ChunkPosition | null = position

    for (let i = 0; i < count && currentPos !== null; i++) {
      currentPos = this.getNextPosition(currentPos, totalSections)
      if (currentPos) {
        const chunk = this.getChunk(currentPos)
        if (chunk) {
          result.push(chunk)
        }
      }
    }

    return result
  }

  /**
   * Clear all chunks
   */
  clear(): void {
    this.chunks = []
    this.sectionTexts.clear()
  }

  /**
   * Clear chunks for a specific section
   */
  clearSection(sectionIndex: number): void {
    this.chunks = this.chunks.filter((c) => c.sectionIndex !== sectionIndex)
    this.sectionTexts.delete(sectionIndex)
  }

  /**
   * Get raw text for a section
   */
  getSectionText(sectionIndex: number): string | undefined {
    return this.sectionTexts.get(sectionIndex)
  }

  /**
   * Check if section is loaded
   */
  isSectionLoaded(sectionIndex: number): boolean {
    return this.sectionTexts.has(sectionIndex)
  }
}

// Singleton instance
export const chunkManager = new ChunkManager()

