/**
 * Debug utilities for development
 * 
 * These functions are exposed on window.debug for console access.
 * In dev mode, playback state is automatically cleared on refresh.
 */

import { db } from '@/services/storage/db'
import { playbackStateMachine } from '@/features/player/PlaybackStateMachine'
import { chunkManager } from '@/features/player/ChunkManager'
import { usePlayerStore } from '@/features/player/playerStore'
import { ttsBufferManager } from '@/features/player/TTSBufferManager'
import { ttsService as kokoroTTS } from '@/services/tts'

export const debug = {
  /**
   * Clear all playback state (position, audio cache)
   * Books and sections are preserved.
   */
  async clearPlaybackState() {
    console.log('[Debug] Clearing playback state...')
    
    // Clear IndexedDB tables
    await db.playbackStates.clear()
    await db.audioChunks.clear()
    
    // Reset state machine
    playbackStateMachine.reset()
    
    // Clear chunk manager
    chunkManager.clear()
    
    // Reset Zustand store
    const store = usePlayerStore.getState()
    store.setCurrentBook(null)
    store.setPlaybackStatus('idle')
    store.setPosition({ sectionIndex: 0, chunkIndex: 0 })
    store.setError(null)
    
    console.log('[Debug] Playback state cleared!')
  },

  /**
   * Clear everything including books
   */
  async clearAll() {
    console.log('[Debug] Clearing ALL data...')
    
    // Clear all IndexedDB tables
    await db.books.clear()
    await db.sections.clear()
    await db.playbackStates.clear()
    await db.audioChunks.clear()
    await db.bookmarks.clear()
    await db.settings.clear()
    
    // Reset everything
    playbackStateMachine.reset()
    chunkManager.clear()
    
    // Reset store
    const store = usePlayerStore.getState()
    store.setCurrentBook(null)
    store.setPlaybackStatus('idle')
    store.setPosition({ sectionIndex: 0, chunkIndex: 0 })
    store.setError(null)
    
    console.log('[Debug] ALL data cleared! Refresh the page.')
  },

  /**
   * Log current state for debugging
   */
  logState() {
    console.log('[Debug] Current state:')
    console.log('  StateMachine:', playbackStateMachine.getState())
    console.log('  Store:', usePlayerStore.getState())
  },

  /**
   * Inspect background TTS buffering status (Kokoro)
   */
  bufferStatus() {
    const status = ttsBufferManager.getStatus()
    console.log('[Debug] Buffer status:', status)
    return status
  },

  /**
   * Wake the buffer loop (useful after changing settings)
   */
  kickBuffer() {
    console.log('[Debug] Kicking buffer loop...')
    ttsBufferManager.kick()
  },

  /**
   * Toggle full chunk text logging for Kokoro generation.
   * Note: enabling this while buffering can heavily slow DevTools.
   */
  ttsFullLogs(enabled: boolean) {
    console.log('[Debug] TTS full logs:', enabled)
    kokoroTTS.setLogFullChunkText(enabled)
  },

  /**
   * Get raw IndexedDB data
   */
  async dumpDB() {
    return {
      books: await db.books.toArray(),
      sections: await db.sections.toArray(),
      playbackStates: await db.playbackStates.toArray(),
      audioChunks: await db.audioChunks.count(),
      bookmarks: await db.bookmarks.toArray(),
      settings: await db.settings.toArray(),
    }
  }
}

// Expose on window for console access
declare global {
  interface Window {
    debug: typeof debug
  }
}

/**
 * Initialize debug utilities
 */
export function initDebug() {
  // Expose debug utilities globally
  window.debug = debug
  
  console.log('[Debug] Debug utilities available at window.debug')
  console.log('[Debug] Commands: debug.clearPlaybackState(), debug.clearAll(), debug.logState(), debug.dumpDB()')
}

