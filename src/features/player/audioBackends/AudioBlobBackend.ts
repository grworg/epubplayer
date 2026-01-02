/**
 * Audio Blob Backend
 * 
 * Uses HTMLAudioElement to play pre-generated audio blobs.
 * Used for Kokoro and Piper TTS which generate audio files.
 */

import type { AudioBackend, PlayOptions, AudioBackendEvents } from './AudioBackend'

export class AudioBlobBackend implements AudioBackend {
  private audio: HTMLAudioElement
  private currentObjectUrl: string | null = null
  private _isPlaying = false
  private _isPaused = false
  private events: AudioBackendEvents = {}
  private currentAbortHandler: (() => void) | null = null
  private currentPlaybackCleanup: (() => void) | null = null

  constructor(events?: AudioBackendEvents) {
    if (events) this.events = events
    
    this.audio = new Audio()
    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    this.audio.addEventListener('play', () => {
      this._isPlaying = true
      this._isPaused = false
      this.events.onStart?.()
    })

    this.audio.addEventListener('pause', () => {
      if (!this.audio.ended) {
        this._isPaused = true
        this._isPlaying = false
        this.events.onPause?.()
      }
    })

    this.audio.addEventListener('timeupdate', () => {
      if (this.audio.duration) {
        this.events.onProgress?.(this.audio.currentTime, this.audio.duration)
      }
    })

    this.audio.addEventListener('error', (e) => {
      console.error('[AudioBlobBackend] Audio error:', e)
      this._isPlaying = false
      this._isPaused = false
      this.events.onError?.('Audio playback error')
    })
  }

  private revokeCurrentUrl(): void {
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl)
      this.currentObjectUrl = null
    }
  }

  /**
   * Play text - not supported for blob backend
   * Use playBlob instead
   */
  async play(_text: string, _options?: PlayOptions): Promise<void> {
    throw new Error('AudioBlobBackend requires playBlob() with pre-generated audio')
  }

  /**
   * Play an audio blob
   * @param blob - The audio blob to play
   * @param options.signal - AbortSignal for cancellation
   * @param options.speed - Playback speed (1.0 = normal)
   * @param options.startTime - Start playback at this time (seconds), for resuming mid-chunk
   */
  async playBlob(blob: Blob, options?: PlayOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check abort signal
      if (options?.signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }

      // Clean up previous
      this.revokeCurrentUrl()
      this.removeAbortHandler()
      this.removePlaybackHandlers()

      // Create new URL and set source
      this.currentObjectUrl = URL.createObjectURL(blob)
      this.audio.src = this.currentObjectUrl

      // Set speed
      if (options?.speed) {
        this.audio.playbackRate = options.speed
      }

      // Set start time if specified (for resuming mid-chunk)
      // Note: Setting currentTime before play() works in modern browsers
      if (options?.startTime && options.startTime > 0) {
        this.audio.currentTime = options.startTime
      }

      // Set up abort handling
      const abortHandler = () => {
        // IMPORTANT: remove ended/error listeners so stale events can't fire after abort/seek
        cleanup()
        this.stop()
        reject(new DOMException('Aborted', 'AbortError'))
      }
      
      if (options?.signal) {
        options.signal.addEventListener('abort', abortHandler)
        this.currentAbortHandler = () => {
          options.signal?.removeEventListener('abort', abortHandler)
        }
      }

      // Set up completion handlers
      const onEnded = () => {
        this._isPlaying = false
        this._isPaused = false
        this.removeAbortHandler()
        this.events.onEnd?.()
        cleanup()
        resolve()
      }

      const onError = (e: Event) => {
        this._isPlaying = false
        this._isPaused = false
        this.removeAbortHandler()
        cleanup()
        reject(new Error('Audio playback failed: ' + (e as ErrorEvent).message))
      }

      const cleanup = () => {
        this.audio.removeEventListener('ended', onEnded)
        this.audio.removeEventListener('error', onError)
        if (this.currentPlaybackCleanup === cleanup) {
          this.currentPlaybackCleanup = null
        }
      }

      this.currentPlaybackCleanup = cleanup
      this.audio.addEventListener('ended', onEnded, { once: true })
      this.audio.addEventListener('error', onError, { once: true })

      // Start playback - browser handles buffering automatically
      this.audio.play().catch((error) => {
        cleanup()
        reject(error)
      })
    })
  }

  private removePlaybackHandlers(): void {
    if (this.currentPlaybackCleanup) {
      this.currentPlaybackCleanup()
      this.currentPlaybackCleanup = null
    }
  }

  private removeAbortHandler(): void {
    if (this.currentAbortHandler) {
      this.currentAbortHandler()
      this.currentAbortHandler = null
    }
  }

  pause(): void {
    if (this._isPlaying && !this._isPaused) {
      this.audio.pause()
    }
  }

  resume(): void {
    if (this._isPaused) {
      this.audio.play().catch((e) => {
        console.error('[AudioBlobBackend] Resume failed:', e)
      })
    }
  }

  stop(): void {
    this.audio.pause()
    this.audio.currentTime = 0
    this._isPlaying = false
    this._isPaused = false
    this.revokeCurrentUrl()
    this.removeAbortHandler()
    this.removePlaybackHandlers()
  }

  isPlaying(): boolean {
    return this._isPlaying && !this._isPaused
  }

  isPaused(): boolean {
    return this._isPaused
  }

  setSpeed(speed: number): void {
    this.audio.playbackRate = Math.max(0.5, Math.min(3, speed))
  }

  getSpeed(): number {
    return this.audio.playbackRate
  }

  /**
   * Get current playback time
   */
  getCurrentTime(): number {
    return this.audio.currentTime
  }

  /**
   * Get total duration
   */
  getDuration(): number {
    return this.audio.duration || 0
  }

  /**
   * Seek to position
   */
  seekTo(time: number): void {
    this.audio.currentTime = Math.max(0, Math.min(time, this.getDuration()))
  }

  /**
   * Seek relative to current position
   */
  seekRelative(delta: number): void {
    this.seekTo(this.audio.currentTime + delta)
  }

  destroy(): void {
    this.stop()
    this.audio.remove()
  }
}

