/**
 * Audio Backend Interface
 * 
 * Unified interface for different audio playback methods:
 * - Browser TTS (Web Speech API)
 * - Audio Blob (HTMLAudioElement for Kokoro/Piper generated audio)
 */

export interface PlayOptions {
  voiceId?: string
  speed?: number
  signal?: AbortSignal
  /** Start playback at this time (seconds). Used for resuming mid-chunk. */
  startTime?: number
}

export interface AudioBackend {
  /**
   * Play audio for the given text
   * Resolves when playback completes, rejects on error or abort
   */
  play(text: string, options?: PlayOptions): Promise<void>

  /**
   * Play an audio blob directly (for pre-generated audio)
   */
  playBlob?(blob: Blob, options?: PlayOptions): Promise<void>

  /**
   * Pause current playback (can be resumed)
   */
  pause(): void

  /**
   * Resume paused playback
   */
  resume(): void

  /**
   * Stop playback completely (cannot be resumed)
   */
  stop(): void

  /**
   * Check if currently playing
   */
  isPlaying(): boolean

  /**
   * Check if currently paused
   */
  isPaused(): boolean

  /**
   * Set playback speed (1.0 = normal)
   */
  setSpeed(speed: number): void

  /**
   * Get current playback speed
   */
  getSpeed(): number

  /**
   * Cleanup resources
   */
  destroy(): void
}

/**
 * Events emitted by audio backends
 */
export interface AudioBackendEvents {
  onStart?: () => void
  onEnd?: () => void
  onPause?: () => void
  onResume?: () => void
  onError?: (error: string) => void
  onProgress?: (current: number, total: number) => void
}

export type AudioBackendType = 'browser-tts' | 'audio-blob'

