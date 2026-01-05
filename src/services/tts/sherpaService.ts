/**
 * Sherpa-ONNX TTS Service
 *
 * High-quality neural TTS using Sherpa-ONNX with Piper models.
 * Includes proper phonemization via bundled espeak-ng data.
 * Uses pre-built WASM from k2-fsa HuggingFace Space.
 */

import { createLogger, handleWorkerLog, type WorkerLogMessage } from '@/services/logging'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { splitTextIntoChunks } from './textChunking'

const log = createLogger('tts')

// ============================================================================
// Types
// ============================================================================

export interface SherpaConfig {
  voiceId: string
  speakerId: number
  speed: number
  maxChunkChars: number
}

export interface SherpaGeneratedAudio {
  requestId: string
  blob: Blob
  duration: number
  chunkIndex: number
  text: string
}

type AudioCallback = (audio: SherpaGeneratedAudio) => void
type ProgressCallback = (status: string, progress?: number) => void
type ErrorCallback = (error: string, requestId?: string) => void
type ReadyCallback = () => void

// ============================================================================
// Available Sherpa Voices
// ============================================================================

// Sherpa-ONNX uses Piper models with multi-speaker support
// The HuggingFace demo uses libritts_r which has 904 speakers
export const SHERPA_VOICES = [
  { id: 'speaker-0', name: 'Speaker 0', speakerId: 0, description: 'Default voice' },
  { id: 'speaker-1', name: 'Speaker 1', speakerId: 1, description: 'Alternative voice 1' },
  { id: 'speaker-2', name: 'Speaker 2', speakerId: 2, description: 'Alternative voice 2' },
  { id: 'speaker-3', name: 'Speaker 3', speakerId: 3, description: 'Alternative voice 3' },
  { id: 'speaker-4', name: 'Speaker 4', speakerId: 4, description: 'Alternative voice 4' },
  { id: 'speaker-5', name: 'Speaker 5', speakerId: 5, description: 'Alternative voice 5' },
  { id: 'speaker-10', name: 'Speaker 10', speakerId: 10, description: 'Alternative voice 10' },
  { id: 'speaker-20', name: 'Speaker 20', speakerId: 20, description: 'Alternative voice 20' },
  { id: 'speaker-50', name: 'Speaker 50', speakerId: 50, description: 'Alternative voice 50' },
  { id: 'speaker-100', name: 'Speaker 100', speakerId: 100, description: 'Alternative voice 100' },
] as const

export type SherpaVoiceId = (typeof SHERPA_VOICES)[number]['id']

// Default speed setting
const DEFAULT_SPEED = 1.0

// ============================================================================
// Sherpa Service Class
// ============================================================================

class SherpaService {
  private worker: Worker | null = null
  private isReady = false
  private isLoading = false
  private config: SherpaConfig | null = null

  // Callbacks
  private onAudioCallback?: AudioCallback
  private onProgressCallback?: ProgressCallback
  private onErrorCallback?: ErrorCallback
  private onReadyCallback?: ReadyCallback

  // Promise for initialization completion
  private initPromise: Promise<void> | null = null
  private initResolve: (() => void) | null = null
  private initReject: ((error: Error) => void) | null = null

  // Request tracking
  private pendingRequests = new Map<
    string,
    {
      chunkIndex: number
      text: string
      resolve: (audio: SherpaGeneratedAudio) => void
      reject: (error: Error) => void
    }
  >()
  private requestCounter = 0

  /**
   * Initialize the Sherpa service
   * Returns a promise that resolves when models are fully loaded
   */
  async initialize(configOverrides?: Partial<SherpaConfig>): Promise<void> {
    // If already ready, check if config changed
    if (this.isReady && this.worker && this.config) {
      const desired = await this.computeDesiredConfig(configOverrides)
      const same =
        desired.voiceId === this.config.voiceId &&
        desired.speakerId === this.config.speakerId &&
        desired.speed === this.config.speed &&
        desired.maxChunkChars === this.config.maxChunkChars

      if (same) return

      log.info('Sherpa config changed, reinitializing worker')
      this.destroy()
    }

    // If already loading, wait for the existing promise
    if (this.isLoading && this.initPromise) {
      return this.initPromise
    }

    this.isLoading = true

    // Create a promise that will be resolved when worker sends 'ready'
    this.initPromise = new Promise<void>((resolve, reject) => {
      this.initResolve = resolve
      this.initReject = reject
    })

    try {
      this.config = await this.computeDesiredConfig(configOverrides)

      log.info('Sherpa initializing', { config: this.config })

      // Create worker
      this.worker = new Worker(new URL('./sherpaWorker.ts', import.meta.url), {
        type: 'module',
      })

      this.setupWorkerListeners()

      // Initialize the worker
      this.worker.postMessage({
        type: 'init',
      })

      // Wait for the worker to be ready
      return this.initPromise
    } catch (error) {
      this.isLoading = false
      this.initReject?.(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  private async computeDesiredConfig(configOverrides?: Partial<SherpaConfig>): Promise<SherpaConfig> {
    // Load settings
    const [sherpaVoice, maxChunkChars] = await Promise.all([
      settingsRepository.get('sherpaVoice'),
      settingsRepository.get('maxChunkChars'),
    ])

    // Find speaker ID from voice ID
    const voice = SHERPA_VOICES.find(v => v.id === sherpaVoice) || SHERPA_VOICES[0]

    return {
      voiceId: configOverrides?.voiceId ?? sherpaVoice,
      speakerId: configOverrides?.speakerId ?? voice.speakerId,
      speed: configOverrides?.speed ?? DEFAULT_SPEED,
      maxChunkChars: configOverrides?.maxChunkChars ?? maxChunkChars,
    }
  }

  private setupWorkerListeners() {
    if (!this.worker) return

    this.worker.onmessage = (event) => {
      const data = event.data

      switch (data.type) {
        case 'log':
          // Forward worker logs through structured logging
          handleWorkerLog(data as WorkerLogMessage)
          break

        case 'progress':
          this.onProgressCallback?.(data.status, data.progress)
          break

        case 'ready':
          log.info('Sherpa models ready', { numSpeakers: data.numSpeakers })
          this.isReady = true
          this.isLoading = false
          this.initResolve?.()
          this.initPromise = null
          this.initResolve = null
          this.initReject = null
          this.onReadyCallback?.()
          break

        case 'audio':
          log.debug('Sherpa audio generated', { requestId: data.requestId })
          this.handleAudioResponse(data)
          break

        case 'error':
          log.error('Sherpa error', { message: data.message })
          this.isLoading = false
          // Reject init promise if still pending
          if (this.initReject && !data.requestId) {
            this.initReject(new Error(data.message))
            this.initPromise = null
            this.initResolve = null
            this.initReject = null
          }
          this.onErrorCallback?.(data.message, data.requestId)
          // Reject pending request if applicable
          if (data.requestId) {
            const req = this.pendingRequests.get(data.requestId)
            if (req) {
              req.reject(new Error(data.message))
              this.pendingRequests.delete(data.requestId)
            }
          }
          break

        case 'cancelled':
          log.debug('Sherpa generation was cancelled', { requestId: data.requestId })
          if (data.requestId) {
            const req = this.pendingRequests.get(data.requestId)
            if (req) {
              req.reject(new Error('Generation cancelled'))
              this.pendingRequests.delete(data.requestId)
            }
          }
          break
      }
    }

    this.worker.onerror = (error) => {
      log.error('Sherpa worker error', error)
      this.isLoading = false
      if (this.initReject) {
        this.initReject(new Error(error.message || 'Worker error'))
        this.initPromise = null
        this.initResolve = null
        this.initReject = null
      }
      this.onErrorCallback?.(error.message || 'Worker error')
    }
  }

  private handleAudioResponse(data: { requestId: string; audioBlob: Blob; duration: number }) {
    const request = this.pendingRequests.get(data.requestId)
    if (!request) return

    const audio: SherpaGeneratedAudio = {
      requestId: data.requestId,
      blob: data.audioBlob,
      duration: data.duration,
      chunkIndex: request.chunkIndex,
      text: request.text,
    }

    // Call the callback
    this.onAudioCallback?.(audio)

    // Resolve the promise
    request.resolve(audio)
    this.pendingRequests.delete(data.requestId)
  }

  /**
   * Generate audio for a chunk of text
   */
  async generateChunk(text: string, chunkIndex: number, voiceId?: string): Promise<SherpaGeneratedAudio> {
    if (!this.isReady) {
      log.debug('Sherpa not ready, initializing...')
    }
    await this.initialize()

    if (!this.worker || !this.isReady) {
      throw new Error('Sherpa service not initialized')
    }

    const requestId = `sherpa_${++this.requestCounter}_${Date.now()}`
    log.debug('Sherpa generating chunk', { chunkIndex, textLength: text.length, requestId })

    // Get speaker ID from voice ID
    const voice = SHERPA_VOICES.find(v => v.id === (voiceId || this.config?.voiceId)) || SHERPA_VOICES[0]
    const speakerId = voice.speakerId

    // Sherpa is fast - 60s timeout should be plenty
    const timeoutMs = 60_000

    return new Promise((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        this.pendingRequests.delete(requestId)
        try {
          this.worker?.postMessage({ type: 'cancel', requestId })
        } catch {
          // ignore
        }
        reject(new Error(`Sherpa generation timed out after ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)

      this.pendingRequests.set(requestId, {
        chunkIndex,
        text,
        resolve: (audio) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          resolve(audio)
        },
        reject: (err) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          reject(err)
        },
      })

      this.worker!.postMessage({
        type: 'generate',
        requestId,
        text,
        speakerId,
        speed: this.config?.speed || DEFAULT_SPEED,
      })
    })
  }

  /**
   * Cancel pending generation requests
   */
  cancel(requestId?: string): void {
    if (!this.worker) return

    this.worker.postMessage({
      type: 'cancel',
      requestId,
    })

    if (requestId) {
      const req = this.pendingRequests.get(requestId)
      if (req) {
        req.reject(new DOMException('Cancelled', 'AbortError') as unknown as Error)
      }
      this.pendingRequests.delete(requestId)
    } else {
      for (const [id, req] of this.pendingRequests.entries()) {
        req.reject(new DOMException('Cancelled', 'AbortError') as unknown as Error)
        this.pendingRequests.delete(id)
      }
    }
  }

  /**
   * Cancel all and reset
   */
  cancelAll(): void {
    this.cancel()
  }

  /**
   * Split text into chunks suitable for TTS
   */
  splitIntoChunks(text: string): string[] {
    const maxChars = this.config?.maxChunkChars || 300
    return splitTextIntoChunks(text, maxChars)
  }

  /**
   * Check if service is ready
   */
  getIsReady(): boolean {
    return this.isReady
  }

  /**
   * Check if service is loading
   */
  getIsLoading(): boolean {
    return this.isLoading
  }

  /**
   * Get current configuration
   */
  getConfig(): SherpaConfig | null {
    return this.config
  }

  /**
   * Update voice
   */
  async setVoice(voiceId: string): Promise<void> {
    await settingsRepository.set('sherpaVoice', voiceId)
    if (this.config) {
      const voice = SHERPA_VOICES.find(v => v.id === voiceId) || SHERPA_VOICES[0]
      this.config.voiceId = voiceId
      this.config.speakerId = voice.speakerId
    }
  }

  // ============================================================================
  // Event handlers
  // ============================================================================

  onAudio(callback: AudioCallback): void {
    this.onAudioCallback = callback
  }

  onProgress(callback: ProgressCallback): void {
    this.onProgressCallback = callback
  }

  onError(callback: ErrorCallback): void {
    this.onErrorCallback = callback
  }

  onReady(callback: ReadyCallback): void {
    this.onReadyCallback = callback
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.cancel()
    if (this.initReject) {
      this.initReject(new Error('Sherpa service destroyed during initialization'))
      this.initPromise = null
      this.initResolve = null
      this.initReject = null
    }
    this.worker?.terminate()
    this.worker = null
    this.isReady = false
    this.isLoading = false
  }
}

// Singleton instance
export const sherpaService = new SherpaService()

