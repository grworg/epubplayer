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

export interface SectionProgress {
  /** Current position within section in seconds (estimated) */
  position: number
  /** Total section duration in seconds (estimated) */
  duration: number
  /** Progress as percentage (0-100) */
  percent: number
}

/** Estimate TTS duration from text length. ~13 chars/sec is typical for TTS. */
function estimateDuration(text: string): number {
  return Math.max(1, text.length / 13)
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

  /**
   * Convert a section time (in seconds) to a chunk position.
   * This is the inverse of getSectionProgress - used for seeking from lock screen.
   * 
   * @param sectionIndex - Section to seek within
   * @param targetTime - Target time in seconds from section start
   * @returns Chunk position and time offset within that chunk, or null if invalid
   */
  getChunkPositionFromTime(
    sectionIndex: number,
    targetTime: number
  ): { chunkIndex: number; timeInChunk: number } | null {
    const sectionChunks = this.getSectionChunks(sectionIndex)
    
    if (sectionChunks.length === 0) {
      return null
    }

    // Calculate estimated durations for all chunks
    const estimatedDurations = sectionChunks.map(c => estimateDuration(c.text))
    
    // Find which chunk contains the target time
    let accumulatedTime = 0
    for (let i = 0; i < sectionChunks.length; i++) {
      const chunkDuration = estimatedDurations[i]
      
      if (accumulatedTime + chunkDuration >= targetTime) {
        // Found the chunk - calculate time offset within it
        const timeInChunk = Math.max(0, targetTime - accumulatedTime)
        return {
          chunkIndex: i,
          timeInChunk,
        }
      }
      
      accumulatedTime += chunkDuration
    }
    
    // Target time exceeds section duration - return last chunk at its end
    const lastIndex = sectionChunks.length - 1
    return {
      chunkIndex: lastIndex,
      timeInChunk: estimatedDurations[lastIndex] ?? 0,
    }
  }

  /**
   * Calculate section-level progress for Media Session lock screen display.
   * Uses text length estimates to provide smooth progress that doesn't reset every chunk.
   * 
   * @param position - Current chunk position
   * @param currentChunkTime - Current playback time within the chunk (seconds)
   * @param currentChunkDuration - Actual duration of the current chunk (seconds), if known
   */
  getSectionProgress(
    position: ChunkPosition,
    currentChunkTime: number,
    currentChunkDuration?: number
  ): SectionProgress {
    const sectionChunks = this.getSectionChunks(position.sectionIndex)
    
    if (sectionChunks.length === 0) {
      return { position: 0, duration: 0, percent: 0 }
    }

    // Calculate estimated durations for all chunks
    const estimatedDurations = sectionChunks.map(c => estimateDuration(c.text))
    const totalDuration = estimatedDurations.reduce((sum, d) => sum + d, 0)

    // Calculate position: sum of completed chunks + current position in current chunk
    let completedDuration = 0
    for (let i = 0; i < position.chunkIndex; i++) {
      completedDuration += estimatedDurations[i] ?? 0
    }

    // For the current chunk, use actual duration if available, otherwise estimate
    const currentChunkEstimate = estimatedDurations[position.chunkIndex] ?? 0
    const actualChunkDuration = currentChunkDuration ?? currentChunkEstimate
    
    // Scale the current time proportionally if actual duration differs from estimate
    // This ensures smooth progress even when actual != estimated
    let scaledCurrentTime = currentChunkTime
    if (actualChunkDuration > 0 && currentChunkEstimate > 0) {
      // What fraction through the current chunk are we?
      const chunkProgress = currentChunkTime / actualChunkDuration
      // Apply that fraction to the estimated duration for consistent section progress
      scaledCurrentTime = chunkProgress * currentChunkEstimate
    }

    const currentPosition = completedDuration + scaledCurrentTime
    const percent = totalDuration > 0 ? (currentPosition / totalDuration) * 100 : 0

    return {
      position: currentPosition,
      duration: totalDuration,
      percent: Math.min(100, percent),
    }
  }
}

// Singleton instance
export const chunkManager = new ChunkManager()

