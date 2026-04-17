/**
 * Screen Wake Lock Service
 * 
 * Prevents the device screen from dimming or locking while audio is playing.
 * This improves UX for users who want to see the playback screen while listening.
 * 
 * The service handles:
 * - Acquiring and releasing wake locks
 * - Re-acquiring after visibility changes (tab hidden/shown)
 * - Graceful handling of permission denials and battery saver modes
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
 */

import { createLogger } from '@/services/logging'

const log = createLogger('audio')

class WakeLockService {
  private wakeLock: WakeLockSentinel | null = null
  private isSupported: boolean
  private shouldBeActive = false
  private visibilityHandler: (() => void) | null = null

  constructor() {
    this.isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
    if (this.isSupported) {
      log.debug('Screen Wake Lock API supported')
    }
  }

  /**
   * Check if the Wake Lock API is available
   */
  get supported(): boolean {
    return this.isSupported
  }

  /**
   * Check if wake lock is currently active
   */
  get active(): boolean {
    return this.wakeLock !== null && !this.wakeLock.released
  }

  /**
   * Acquire a screen wake lock.
   * Call this when starting audio playback.
   * 
   * The lock will be automatically re-acquired when the page becomes
   * visible again after being hidden.
   */
  async acquire(): Promise<void> {
    if (!this.isSupported) return

    this.shouldBeActive = true
    this.setupVisibilityHandler()

    await this.requestWakeLock()
  }

  /**
   * Release the screen wake lock.
   * Call this when pausing or stopping audio playback.
   */
  release(): void {
    this.shouldBeActive = false
    this.removeVisibilityHandler()

    if (this.wakeLock) {
      this.wakeLock.release()
        .then(() => {
          log.debug('Wake lock released')
        })
        .catch((error) => {
          log.warn('Failed to release wake lock', error)
        })
      this.wakeLock = null
    }
  }

  /**
   * Request a wake lock from the browser.
   * This may fail due to:
   * - Permission denied
   * - Battery saver mode
   * - Page not visible
   * - Document not active
   */
  private async requestWakeLock(): Promise<void> {
    if (this.wakeLock && !this.wakeLock.released) {
      return
    }

    try {
      this.wakeLock = await navigator.wakeLock!.request('screen')
      
      this.wakeLock.addEventListener('release', () => {
        log.debug('Wake lock was released')
        this.wakeLock = null
        
        if (this.shouldBeActive && document.visibilityState === 'visible') {
          log.debug('Re-acquiring wake lock after unexpected release')
          this.requestWakeLock()
        }
      })

      log.info('Wake lock acquired - screen will stay on')
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          log.debug('Wake lock not allowed (battery saver or permission denied)')
        } else {
          log.warn('Failed to acquire wake lock', error)
        }
      }
    }
  }

  /**
   * Set up visibility change handler to re-acquire wake lock
   * when returning from background.
   */
  private setupVisibilityHandler(): void {
    if (this.visibilityHandler) return

    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.shouldBeActive) {
        log.debug('Page became visible, re-acquiring wake lock')
        this.requestWakeLock()
      }
    }

    document.addEventListener('visibilitychange', this.visibilityHandler)
  }

  /**
   * Remove the visibility change handler
   */
  private removeVisibilityHandler(): void {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler)
      this.visibilityHandler = null
    }
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    this.release()
    this.removeVisibilityHandler()
  }
}

export const wakeLockService = new WakeLockService()
