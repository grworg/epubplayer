/**
 * Media Session Manager
 * 
 * Integrates with the Media Session API to:
 * - Show playback info on lock screen / notification
 * - Handle hardware media button events
 * - Enable background audio playback on mobile
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API
 */

import { createLogger } from '@/services/logging'
import type { Book } from './playerStore'

const log = createLogger('media')

// Action handlers that will be connected to PlaybackController
interface MediaSessionActions {
  onPlay: () => void
  onPause: () => void
  onSeekForward: () => void
  onSeekBackward: () => void
  onNextTrack: () => void
  onPreviousTrack: () => void
  onStop: () => void
}

class MediaSessionManager {
  private isSupported: boolean
  private actions: MediaSessionActions | null = null
  private currentBook: Book | null = null
  private currentChapterTitle: string = ''

  constructor() {
    this.isSupported = 'mediaSession' in navigator
    if (!this.isSupported) {
      log.debug('Media Session API not supported')
    }
  }

  /**
   * Initialize with action handlers from PlaybackController
   */
  init(actions: MediaSessionActions): void {
    if (!this.isSupported) return

    this.actions = actions
    this.setupActionHandlers()
    log.debug('Media Session initialized')
  }

  /**
   * Update metadata when book changes
   */
  setBook(book: Book | null): void {
    this.currentBook = book
    this.updateMetadata()
  }

  /**
   * Update chapter title (shown as subtitle)
   */
  setChapterTitle(title: string): void {
    this.currentChapterTitle = title
    this.updateMetadata()
  }

  /**
   * Update playback state (playing/paused)
   */
  setPlaybackState(state: 'playing' | 'paused' | 'none'): void {
    if (!this.isSupported) return

    try {
      navigator.mediaSession.playbackState = state
    } catch {
      // Some browsers don't support playbackState
    }
  }

  /**
   * Update position state (for seek bar on lock screen)
   */
  setPositionState(options: {
    duration: number
    position: number
    playbackRate?: number
  }): void {
    if (!this.isSupported) return

    try {
      // Only set if we have valid values
      if (options.duration > 0 && options.position >= 0) {
        navigator.mediaSession.setPositionState({
          duration: options.duration,
          position: Math.min(options.position, options.duration),
          playbackRate: options.playbackRate ?? 1,
        })
      }
    } catch {
      // Position state not supported or invalid values
    }
  }

  /**
   * Clear position state (e.g., when stopping)
   */
  clearPositionState(): void {
    if (!this.isSupported) return

    try {
      navigator.mediaSession.setPositionState()
    } catch {
      // Ignore
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupActionHandlers(): void {
    if (!this.isSupported || !this.actions) return

    const session = navigator.mediaSession

    // Play/Pause
    session.setActionHandler('play', () => {
      log.debug('Media action: play')
      this.actions?.onPlay()
    })

    session.setActionHandler('pause', () => {
      log.debug('Media action: pause')
      this.actions?.onPause()
    })

    // Seek (15 seconds forward/back - standard audiobook behavior)
    session.setActionHandler('seekforward', (details) => {
      log.debug('Media action: seekforward', { offset: details?.seekOffset ?? 15 })
      this.actions?.onSeekForward()
    })

    session.setActionHandler('seekbackward', (details) => {
      log.debug('Media action: seekbackward', { offset: details?.seekOffset ?? 15 })
      this.actions?.onSeekBackward()
    })

    // Track navigation (chapter skip)
    session.setActionHandler('nexttrack', () => {
      log.debug('Media action: nexttrack')
      this.actions?.onNextTrack()
    })

    session.setActionHandler('previoustrack', () => {
      log.debug('Media action: previoustrack')
      this.actions?.onPreviousTrack()
    })

    // Stop
    session.setActionHandler('stop', () => {
      log.debug('Media action: stop')
      this.actions?.onStop()
    })

    // Optional: Handle seeking to specific position
    // Some platforms support this for a seek bar
    try {
      session.setActionHandler('seekto', (details) => {
        if (details?.seekTime !== undefined) {
          log.debug('Media action: seekto', { seekTime: details.seekTime })
          // We don't have direct seek-to-time, but this shows the handler is set
        }
      })
    } catch {
      // Not all browsers support seekto
    }

    log.debug('Media Session action handlers registered')
  }

  private updateMetadata(): void {
    if (!this.isSupported) return

    if (!this.currentBook) {
      // Clear metadata when no book
      try {
        navigator.mediaSession.metadata = null
      } catch {
        // Ignore
      }
      return
    }

    // Build artwork array if cover exists
    const artwork: MediaImage[] = []
    if (this.currentBook.coverUrl) {
      artwork.push(
        { src: this.currentBook.coverUrl, sizes: '96x96', type: 'image/jpeg' },
        { src: this.currentBook.coverUrl, sizes: '128x128', type: 'image/jpeg' },
        { src: this.currentBook.coverUrl, sizes: '192x192', type: 'image/jpeg' },
        { src: this.currentBook.coverUrl, sizes: '256x256', type: 'image/jpeg' },
        { src: this.currentBook.coverUrl, sizes: '384x384', type: 'image/jpeg' },
        { src: this.currentBook.coverUrl, sizes: '512x512', type: 'image/jpeg' }
      )
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.currentChapterTitle || this.currentBook.title,
        artist: this.currentBook.author,
        album: this.currentBook.title,
        artwork,
      })
      log.debug('Media Session metadata updated', { title: this.currentChapterTitle || this.currentBook.title, artist: this.currentBook.author })
    } catch (e) {
      log.error('Failed to set media metadata', e)
    }
  }

  /**
   * Clean up (call when app unmounts)
   */
  destroy(): void {
    if (!this.isSupported) return

    // Clear all action handlers
    const actions: MediaSessionAction[] = [
      'play', 'pause', 'seekforward', 'seekbackward',
      'nexttrack', 'previoustrack', 'stop'
    ]

    for (const action of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, null)
      } catch {
        // Ignore
      }
    }

    try {
      navigator.mediaSession.metadata = null
      navigator.mediaSession.playbackState = 'none'
    } catch {
      // Ignore
    }

    this.actions = null
    this.currentBook = null
    log.debug('Media Session destroyed')
  }
}

// Singleton instance
export const mediaSessionManager = new MediaSessionManager()

