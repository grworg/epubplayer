/**
 * Piper TTS Service
 *
 * Fast, CPU-friendly neural TTS using Piper/VITS models.
 * Much faster than Kokoro on WASM while maintaining good quality.
 * 
 * Uses sherpa-onnx WASM for inference.
 */

import { createLogger, handleWorkerLog, type WorkerLogMessage } from '@/services/logging'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { splitTextIntoChunks } from './textChunking'

const log = createLogger('tts')

// ============================================================================
// Types
// ============================================================================

export interface PiperConfig {
  modelId: string
  voiceId: string
  maxChunkChars: number
}

export interface PiperGeneratedAudio {
  requestId: string
  blob: Blob
  duration: number
  chunkIndex: number
  text: string
}

type AudioCallback = (audio: PiperGeneratedAudio) => void
type ProgressCallback = (status: string, progress?: number) => void
type ErrorCallback = (error: string, requestId?: string) => void
type ReadyCallback = () => void

// ============================================================================
// Available Piper Models
// ============================================================================

// Models hosted on Hugging Face (sherpa-onnx compatible)
// These are optimized for fast CPU inference
export const PIPER_MODELS = [
  {
    id: 'en_US-amy-medium',
    name: 'Amy (US English)',
    language: 'en-US',
    quality: 'medium',
    size: '~20MB',
  },
  {
    id: 'en_US-lessac-medium', 
    name: 'Lessac (US English)',
    language: 'en-US',
    quality: 'medium',
    size: '~20MB',
  },
  {
    id: 'en_GB-alba-medium',
    name: 'Alba (British English)',
    language: 'en-GB',
    quality: 'medium',
    size: '~20MB',
  },
  {
    id: 'en_GB-jenny_dioco-medium',
    name: 'Jenny (British English)',
    language: 'en-GB',
    quality: 'medium',
    size: '~20MB',
  },
] as const

export type PiperModelId = (typeof PIPER_MODELS)[number]['id']

// ============================================================================
// Piper Service Class
// ============================================================================

class PiperService {
  private worker: Worker | null = null
  private isReady = false
  private isLoading = false
  private config: PiperConfig | null = null

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
      resolve: (audio: PiperGeneratedAudio) => void
      reject: (error: Error) => void
    }
  >()
  private requestCounter = 0

  /**
   * Initialize the Piper service with configuration
   * Returns a promise that resolves when the model is fully loaded
   */
  async initialize(configOverrides?: Partial<PiperConfig>): Promise<void> {
    // If already ready, check if config changed
    if (this.isReady && this.worker && this.config) {
      const desired = await this.computeDesiredConfig(configOverrides)
      const same =
        desired.modelId === this.config.modelId &&
        desired.voiceId === this.config.voiceId &&
        desired.maxChunkChars === this.config.maxChunkChars

      if (same) return

      log.info('Piper config changed, reinitializing worker')
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

      log.info('Piper initializing', { config: this.config })

      // Create worker
      this.worker = new Worker(new URL('./piperWorker.ts', import.meta.url), {
        type: 'module',
      })

      this.setupWorkerListeners()

      // Initialize the worker
      this.worker.postMessage({
        type: 'init',
        modelId: this.config.modelId,
      })

      // Wait for the worker to be ready
      return this.initPromise
    } catch (error) {
      this.isLoading = false
      this.initReject?.(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  private async computeDesiredConfig(configOverrides?: Partial<PiperConfig>): Promise<PiperConfig> {
    // Load settings
    const [piperModel, maxChunkChars] = await Promise.all([
      settingsRepository.get('piperModel'),
      settingsRepository.get('maxChunkChars'),
    ])

    return {
      modelId: configOverrides?.modelId ?? piperModel,
      voiceId: configOverrides?.voiceId ?? piperModel, // For Piper, voice = model
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
          log.info('Piper model ready')
          this.isReady = true
          this.isLoading = false
          this.initResolve?.()
          this.initPromise = null
          this.initResolve = null
          this.initReject = null
          this.onReadyCallback?.()
          break

        case 'audio':
          log.debug('Piper audio generated', { requestId: data.requestId })
          this.handleAudioResponse(data)
          break

        case 'error':
          log.error('Piper error', { message: data.message })
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
      }
    }

    this.worker.onerror = (error) => {
      log.error('Piper worker error', error)
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

    const audio: PiperGeneratedAudio = {
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
  async generateChunk(text: string, chunkIndex: number): Promise<PiperGeneratedAudio> {
    if (!this.isReady) {
      log.debug('Piper not ready, initializing...')
    }
    await this.initialize()

    if (!this.worker || !this.isReady) {
      throw new Error('Piper service not initialized')
    }

    const requestId = `piper_${++this.requestCounter}_${Date.now()}`
    log.debug('Piper generating chunk', { chunkIndex, textLength: text.length, requestId })

    // Piper is fast - shorter timeout than Kokoro WASM
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
        reject(new Error(`Piper generation timed out after ${Math.round(timeoutMs / 1000)}s`))
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
    const maxChars = this.config?.maxChunkChars || 320
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
  getConfig(): PiperConfig | null {
    return this.config
  }

  /**
   * Update model/voice
   */
  async setModel(modelId: string): Promise<void> {
    await settingsRepository.set('piperModel', modelId)
    // Reinitialize if already running
    if (this.isReady) {
      this.destroy()
      await this.initialize()
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
      this.initReject(new Error('Piper service destroyed during initialization'))
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
export const piperService = new PiperService()

