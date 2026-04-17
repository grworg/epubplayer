/**
 * Silent Audio Keepalive
 * 
 * Plays a silent audio track to "claim" and maintain the Media Session.
 * This is critical for:
 * - Lock screen metadata and controls
 * - Hardware media button support
 * - Background playback continuity
 * 
 * Used by BOTH backends:
 * 1. BrowserTTSBackend: Web Speech API doesn't use <audio>, so we need this
 *    to claim Media Session.
 * 2. AudioBlobBackend: When changing audio.src between chunks, Android Chrome
 *    kills the Media Session. The keepalive maintains it across src changes.
 * 
 * Without this, Android Chrome will:
 * - Remove lock screen controls after 1-2 chunks
 * - Stop background playback entirely after a few more chunks
 * - Force user to unlock phone and manually press play
 * 
 * @see https://stackoverflow.com/questions/76354522
 */

import { createLogger } from '@/services/logging'

const log = createLogger('audio')

export class SilentAudioKeepalive {
  private audio: HTMLAudioElement | null = null
  private isActive = false

  // 1 second of silence as a base64-encoded WAV file
  // This is a minimal valid WAV: 44 byte header + 8000 bytes of silence (8kHz mono 8-bit)
  private static readonly SILENT_AUDIO_DATA_URI = (() => {
    // Create a minimal silent WAV file programmatically
    const sampleRate = 8000
    const duration = 1 // 1 second
    const numSamples = sampleRate * duration
    const byteRate = sampleRate
    const blockAlign = 1
    const bitsPerSample = 8
    const dataSize = numSamples
    const fileSize = 44 + dataSize - 8

    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)

    // RIFF header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i))
      }
    }

    writeString(0, 'RIFF')
    view.setUint32(4, fileSize, true)
    writeString(8, 'WAVE')

    // fmt chunk
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true) // chunk size
    view.setUint16(20, 1, true) // audio format (PCM)
    view.setUint16(22, 1, true) // num channels (mono)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, bitsPerSample, true)

    // data chunk
    writeString(36, 'data')
    view.setUint32(40, dataSize, true)

    // Silent samples (128 = silence for 8-bit audio)
    for (let i = 0; i < numSamples; i++) {
      view.setUint8(44 + i, 128)
    }

    // Convert to base64
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return 'data:audio/wav;base64,' + btoa(binary)
  })()

  /**
   * Start playing silent audio in a loop
   * Call this when Browser TTS starts speaking
   */
  start(): void {
    if (this.isActive) return

    try {
      this.audio = new Audio(SilentAudioKeepalive.SILENT_AUDIO_DATA_URI)
      this.audio.loop = true
      this.audio.volume = 0.01 // Nearly silent but not zero (some browsers mute at 0)
      
      // Play and handle any autoplay restrictions
      this.audio.play().then(() => {
        this.isActive = true
        log.debug('Keepalive started - Media Session claimed')
      }).catch((e) => {
        log.warn('Keepalive failed to start (autoplay blocked?)', e)
        this.cleanup()
      })
    } catch (e) {
      log.error('Keepalive error creating audio', e)
    }
  }

  /**
   * Stop the silent audio
   * Call this when playback stops
   */
  stop(): void {
    if (!this.isActive) return
    
    this.cleanup()
    log.debug('Keepalive stopped')
  }

  /**
   * Pause the silent audio (keeps media session but paused)
   */
  pause(): void {
    if (this.audio && this.isActive) {
      this.audio.pause()
    }
  }

  /**
   * Resume the silent audio
   */
  resume(): void {
    if (this.audio && this.isActive) {
      this.audio.play().catch(() => {
        // Ignore - might fail if user hasn't interacted
      })
    }
  }

  /**
   * Check if keepalive is running
   */
  isRunning(): boolean {
    return this.isActive
  }

  private cleanup(): void {
    if (this.audio) {
      this.audio.pause()
      this.audio.src = ''
      this.audio = null
    }
    this.isActive = false
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.cleanup()
  }
}

// Singleton instance for use across the app
export const silentAudioKeepalive = new SilentAudioKeepalive()

