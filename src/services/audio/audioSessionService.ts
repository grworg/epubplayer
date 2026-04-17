/**
 * Audio Session Service
 * 
 * Manages the Audio Session API for iOS and other platforms.
 * Setting the session type to "playback" tells the OS to:
 * - Treat web audio as intentional media output
 * - Bypass the hardware silent/ringer switch on iOS
 * - Prioritize this audio session over ambient sounds
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/AudioSession
 */

import { createLogger } from '@/services/logging'

const log = createLogger('audio')

class AudioSessionService {
  private isSupported: boolean
  private currentType: string | null = null

  constructor() {
    this.isSupported = typeof navigator !== 'undefined' && 'audioSession' in navigator
    if (this.isSupported) {
      log.debug('Audio Session API supported')
    }
  }

  /**
   * Check if the Audio Session API is available
   */
  get supported(): boolean {
    return this.isSupported
  }

  /**
   * Set audio session to "playback" mode.
   * This should be called before starting audio playback.
   * 
   * On iOS, this ensures:
   * - Audio plays even when the silent switch is on
   * - Audio is treated as media (not ambient)
   * - Proper audio focus handling
   */
  setPlaybackMode(): void {
    if (!this.isSupported) return

    try {
      const audioSession = (navigator as Navigator & { audioSession: { type: string } }).audioSession
      if (audioSession && audioSession.type !== 'playback') {
        audioSession.type = 'playback'
        this.currentType = 'playback'
        log.info('Audio session set to playback mode')
      }
    } catch (error) {
      log.warn('Failed to set audio session type', error)
    }
  }

  /**
   * Set audio session to "ambient" mode.
   * Call this when audio is not the primary focus.
   */
  setAmbientMode(): void {
    if (!this.isSupported) return

    try {
      const audioSession = (navigator as Navigator & { audioSession: { type: string } }).audioSession
      if (audioSession && audioSession.type !== 'ambient') {
        audioSession.type = 'ambient'
        this.currentType = 'ambient'
        log.debug('Audio session set to ambient mode')
      }
    } catch (error) {
      log.warn('Failed to set audio session type', error)
    }
  }

  /**
   * Reset audio session to auto mode (let browser decide)
   */
  reset(): void {
    if (!this.isSupported) return

    try {
      const audioSession = (navigator as Navigator & { audioSession: { type: string } }).audioSession
      if (audioSession) {
        audioSession.type = 'auto'
        this.currentType = 'auto'
        log.debug('Audio session reset to auto mode')
      }
    } catch (error) {
      log.warn('Failed to reset audio session type', error)
    }
  }

  /**
   * Get current audio session type
   */
  getCurrentType(): string | null {
    return this.currentType
  }
}

export const audioSessionService = new AudioSessionService()
