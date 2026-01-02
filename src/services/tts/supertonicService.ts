/**
 * Supertonic TTS Service
 *
 * Fast, high-quality neural TTS using Supertone's Supertonic models.
 * Uses ONNX Runtime Web for inference with WebGPU/WASM fallback.
 * 
 * Key advantages:
 * - 66M parameters (smaller than Kokoro)
 * - Fast on both WebGPU and WASM (167× real-time)
 * - Excellent text normalization (numbers, dates, abbreviations)
 * - 10 pre-extracted voice styles
 */

import { createLogger, handleWorkerLog, type WorkerLogMessage } from '@/services/logging'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { splitTextIntoChunks } from './textChunking'

const log = createLogger('tts')

// ============================================================================
// Types
// ============================================================================

export interface SupertonicConfig {
  voiceId: string
  totalSteps: number
  speed: number
  maxChunkChars: number
  device: 'wasm' | 'webgpu'
}

export interface SupertonicGeneratedAudio {
  requestId: string
  blob: Blob
  duration: number
  chunkIndex: number
  text: string
}

type AudioCallback = (audio: SupertonicGeneratedAudio) => void
type ProgressCallback = (status: string, progress?: number) => void
type ErrorCallback = (error: string, requestId?: string) => void
type ReadyCallback = () => void

// ============================================================================
// Available Supertonic Voices
// ============================================================================

export const SUPERTONIC_VOICES = [
  { id: 'M1', name: 'Male 1 (M1)', description: 'Default male voice' },
  { id: 'M2', name: 'Male 2 (M2)', description: 'Alternative male voice' },
  { id: 'M3', name: 'Male 3 (M3)', description: 'Third male voice' },
  { id: 'M4', name: 'Male 4 (M4)', description: 'Fourth male voice' },
  { id: 'M5', name: 'Male 5 (M5)', description: 'Fifth male voice' },
  { id: 'F1', name: 'Female 1 (F1)', description: 'Default female voice' },
  { id: 'F2', name: 'Female 2 (F2)', description: 'Alternative female voice' },
  { id: 'F3', name: 'Female 3 (F3)', description: 'Third female voice' },
  { id: 'F4', name: 'Female 4 (F4)', description: 'Fourth female voice' },
  { id: 'F5', name: 'Female 5 (F5)', description: 'Fifth female voice' },
] as const

export type SupertonicVoiceId = (typeof SUPERTONIC_VOICES)[number]['id']

// Default settings
const DEFAULT_VOICE = 'F1'
const DEFAULT_TOTAL_STEPS = 5
const DEFAULT_SPEED = 1.05

// ============================================================================
// Supertonic Service Class
// ============================================================================

class SupertonicService {
  private worker: Worker | null = null
  private isReady = false
  private isLoading = false
  private config: SupertonicConfig | null = null
  private backend: 'webgpu' | 'wasm' | null = null

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
      resolve: (audio: SupertonicGeneratedAudio) => void
      reject: (error: Error) => void
    }
  >()
  private requestCounter = 0

  /**
   * Initialize the Supertonic service
   * Returns a promise that resolves when models are fully loaded
   */
  async initialize(configOverrides?: Partial<SupertonicConfig>): Promise<void> {
    // If already ready, check if config changed
    if (this.isReady && this.worker && this.config) {
      const desired = await this.computeDesiredConfig(configOverrides)
      const same =
        desired.voiceId === this.config.voiceId &&
        desired.totalSteps === this.config.totalSteps &&
        desired.speed === this.config.speed &&
        desired.maxChunkChars === this.config.maxChunkChars &&
        desired.device === this.config.device

      if (same) return

      log.info('Supertonic config changed, reinitializing worker')
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

      log.info('Supertonic initializing', { config: this.config })

      // Create worker
      this.worker = new Worker(new URL('./supertonicWorker.ts', import.meta.url), {
        type: 'module',
      })

      this.setupWorkerListeners()

      // Initialize the worker
      this.worker.postMessage({
        type: 'init',
        voiceId: this.config.voiceId,
        device: this.config.device,
      })

      // Wait for the worker to be ready
      return this.initPromise
    } catch (error) {
      this.isLoading = false
      this.initReject?.(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  private async computeDesiredConfig(configOverrides?: Partial<SupertonicConfig>): Promise<SupertonicConfig> {
    // Load settings
    const [supertonicVoice, maxChunkChars, supertonicDevice] = await Promise.all([
      settingsRepository.get('supertonicVoice'),
      settingsRepository.get('maxChunkChars'),
      settingsRepository.get('supertonicDevice'),
    ])

    return {
      voiceId: configOverrides?.voiceId ?? supertonicVoice,
      totalSteps: configOverrides?.totalSteps ?? DEFAULT_TOTAL_STEPS,
      speed: configOverrides?.speed ?? DEFAULT_SPEED,
      maxChunkChars: configOverrides?.maxChunkChars ?? maxChunkChars,
      device: configOverrides?.device ?? supertonicDevice,
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
          log.info('Supertonic models ready', { backend: data.backend })
          this.isReady = true
          this.isLoading = false
          this.backend = data.backend || 'wasm'
          this.initResolve?.()
          this.initPromise = null
          this.initResolve = null
          this.initReject = null
          this.onReadyCallback?.()
          break

        case 'audio':
          log.debug('Supertonic audio generated', { requestId: data.requestId })
          this.handleAudioResponse(data)
          break

        case 'error':
          log.error('Supertonic error', { message: data.message })
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
          // Worker skipped generation because cancelAll was set
          log.debug('Supertonic generation was cancelled', { requestId: data.requestId })
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
      log.error('Supertonic worker error', error)
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

    const audio: SupertonicGeneratedAudio = {
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
  async generateChunk(text: string, chunkIndex: number, voiceId?: string): Promise<SupertonicGeneratedAudio> {
    if (!this.isReady) {
      log.debug('Supertonic not ready, initializing...')
    }
    await this.initialize()

    if (!this.worker || !this.isReady) {
      throw new Error('Supertonic service not initialized')
    }

    const requestId = `supertonic_${++this.requestCounter}_${Date.now()}`
    log.debug('Supertonic generating chunk', { chunkIndex, textLength: text.length, requestId })

    // Supertonic is fast - 60s timeout should be plenty
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
        reject(new Error(`Supertonic generation timed out after ${Math.round(timeoutMs / 1000)}s`))
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
        voiceId: voiceId || this.config?.voiceId || DEFAULT_VOICE,
        totalSteps: this.config?.totalSteps || DEFAULT_TOTAL_STEPS,
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
  getConfig(): SupertonicConfig | null {
    return this.config
  }

  /**
   * Get current backend (webgpu or wasm)
   */
  getBackend(): 'webgpu' | 'wasm' | null {
    return this.backend
  }

  /**
   * Check if using WASM (slower) backend
   */
  isUsingWasm(): boolean {
    return this.backend === 'wasm'
  }

  /**
   * Update voice
   */
  async setVoice(voiceId: string): Promise<void> {
    await settingsRepository.set('supertonicVoice', voiceId)
    if (this.config) {
      this.config.voiceId = voiceId
    }
    // Send voice change to worker if already running
    if (this.worker && this.isReady) {
      this.worker.postMessage({
        type: 'setVoice',
        voiceId,
      })
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
      this.initReject(new Error('Supertonic service destroyed during initialization'))
      this.initPromise = null
      this.initResolve = null
      this.initReject = null
    }
    this.worker?.terminate()
    this.worker = null
    this.isReady = false
    this.isLoading = false
    this.backend = null
  }
}

// Singleton instance
export const supertonicService = new SupertonicService()

