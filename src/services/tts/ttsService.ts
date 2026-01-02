/**
 * TTS Service
 *
 * High-level interface for Kokoro text-to-speech.
 * Manages the web worker and provides audio generation.
 */

import { createLogger, handleWorkerLog, type WorkerLogMessage } from '@/services/logging'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { splitTextIntoChunks } from './textChunking'

const log = createLogger('tts')

// ============================================================================
// Types
// ============================================================================

export interface TTSConfig {
  modelId: string
  device: 'wasm' | 'webgpu'
  dtype: string
  voiceId: string
  maxChunkChars: number
}

export interface GeneratedAudio {
  requestId: string
  blob: Blob
  duration: number
  chunkIndex: number
  text: string
}

type AudioCallback = (audio: GeneratedAudio) => void
type ProgressCallback = (status: string, progress?: number) => void
type ErrorCallback = (error: string, requestId?: string) => void
type ReadyCallback = () => void

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

const DTYPE_MAP: Record<string, string> = {
  q4: 'q4',
  q8: 'q8',
  fp16: 'fp16',
  fp32: 'fp32',
}

// ============================================================================
// TTS Service Class
// ============================================================================

class TTSService {
  private worker: Worker | null = null
  private isReady = false
  private isLoading = false
  private config: TTSConfig | null = null

  // Callbacks
  private onAudioCallback?: AudioCallback
  private onProgressCallback?: ProgressCallback
  private onErrorCallback?: ErrorCallback
  private onReadyCallback?: ReadyCallback

  // Initialization promise
  private initPromise: Promise<void> | null = null
  private initResolve: (() => void) | null = null
  private initReject: ((error: Error) => void) | null = null

  // Request tracking
  private pendingRequests = new Map<
    string,
    {
      chunkIndex: number
      text: string
      resolve: (audio: GeneratedAudio) => void
      reject: (error: Error) => void
    }
  >()
  private requestCounter = 0

  // Debug
  private logFullChunkText = false

  /**
   * Initialize the TTS service
   */
  async initialize(configOverrides?: Partial<TTSConfig>): Promise<void> {
    // If already ready with same config, return
    if (this.isReady && this.worker && this.config) {
      const desired = await this.buildConfig(configOverrides)
      if (this.configMatches(desired)) return
      
      // Config changed, reinitialize
      log.info('Kokoro config changed, reinitializing')
      this.destroy()
    }

    // If already loading, wait
    if (this.isLoading && this.initPromise) {
      return this.initPromise
    }

    this.isLoading = true

    this.initPromise = new Promise<void>((resolve, reject) => {
      this.initResolve = resolve
      this.initReject = reject
    })

    try {
      this.config = await this.buildConfig(configOverrides)
      log.info('Kokoro initializing', { config: this.config })

      // Create worker
      this.worker = new Worker(new URL('./ttsWorker.ts', import.meta.url), {
        type: 'module',
      })

      this.setupWorkerListeners()

      // Send init message
      this.worker.postMessage({
        type: 'init',
        modelId: this.config.modelId,
        device: this.config.device,
        dtype: this.config.dtype,
      })

      return this.initPromise
    } catch (error) {
      this.isLoading = false
      this.initReject?.(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  private async buildConfig(overrides?: Partial<TTSConfig>): Promise<TTSConfig> {
    const [voiceId, modelConfig, maxChunkChars, processingDevice] = await Promise.all([
      settingsRepository.get('voiceId'),
      settingsRepository.get('modelConfig'),
      settingsRepository.get('maxChunkChars'),
      settingsRepository.get('processingDevice'),
    ])

    // Determine device
    let device: 'wasm' | 'webgpu' = 'wasm'
    const requestedDevice = overrides?.device ?? processingDevice

    if (requestedDevice === 'webgpu') {
      device = (await this.checkWebGPU()) ? 'webgpu' : 'wasm'
    } else if (requestedDevice === 'auto') {
      device = (await this.checkWebGPU()) ? 'webgpu' : 'wasm'
    }

    return {
      modelId: overrides?.modelId ?? DEFAULT_MODEL_ID,
      device,
      dtype: overrides?.dtype ?? (DTYPE_MAP[modelConfig] ?? 'q4'),
      voiceId: overrides?.voiceId ?? voiceId,
      maxChunkChars: overrides?.maxChunkChars ?? maxChunkChars,
    }
  }

  private configMatches(desired: TTSConfig): boolean {
    if (!this.config) return false
    return (
      desired.modelId === this.config.modelId &&
      desired.device === this.config.device &&
      desired.dtype === this.config.dtype &&
      desired.voiceId === this.config.voiceId &&
      desired.maxChunkChars === this.config.maxChunkChars
    )
  }

  private async checkWebGPU(): Promise<boolean> {
    try {
      const gpu = (navigator as unknown as { gpu?: { requestAdapter: (options?: { powerPreference?: string }) => Promise<unknown | null> } }).gpu
      if (!gpu) return false
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
      return !!adapter
    } catch {
      return false
    }
  }

  private setupWorkerListeners() {
    if (!this.worker) return

    this.worker.onmessage = (event) => {
      const { type, ...data } = event.data

      switch (type) {
        case 'log':
          // Forward worker logs through structured logging
          handleWorkerLog(event.data as WorkerLogMessage)
          break

        case 'progress':
          this.onProgressCallback?.(data.status, data.progress)
          break

        case 'ready':
          log.info('Kokoro ready')
          this.isReady = true
          this.isLoading = false
          this.initResolve?.()
          this.initPromise = null
          this.initResolve = null
          this.initReject = null
          this.onReadyCallback?.()
          break

        case 'audio':
          this.handleAudioResponse(data)
          break

        case 'error':
          log.error('Kokoro error', { message: data.message })
          this.isLoading = false
          
          if (this.initReject && !data.requestId) {
            this.initReject(new Error(data.message))
            this.initPromise = null
            this.initResolve = null
            this.initReject = null
          }
          
          this.onErrorCallback?.(data.message, data.requestId)
          
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
      log.error('Kokoro worker error', error)
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

    const audio: GeneratedAudio = {
      requestId: data.requestId,
      blob: data.audioBlob,
      duration: data.duration,
      chunkIndex: request.chunkIndex,
      text: request.text,
    }

    this.onAudioCallback?.(audio)
    request.resolve(audio)
    this.pendingRequests.delete(data.requestId)
  }

  /**
   * Generate audio for a chunk of text
   */
  async generateChunk(text: string, chunkIndex: number, voiceId?: string): Promise<GeneratedAudio> {
    await this.initialize()

    if (!this.worker || !this.isReady) {
      throw new Error('TTS service not initialized')
    }

    const requestId = `req_${++this.requestCounter}_${Date.now()}`
    
    if (this.logFullChunkText) {
      log.debug('Kokoro generating chunk', { chunkIndex, text })
    } else {
      log.debug('Kokoro generating chunk', { chunkIndex, textLength: text.length })
    }

    // Timeout: WASM is slow, WebGPU should be fast
    const timeoutMs = this.config?.device === 'wasm' ? 180_000 : 60_000

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`TTS timed out after ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)

      this.pendingRequests.set(requestId, {
        chunkIndex,
        text,
        resolve: (audio) => {
          clearTimeout(timeout)
          resolve(audio)
        },
        reject: (err) => {
          clearTimeout(timeout)
          reject(err)
        },
      })

      this.worker!.postMessage({
        type: 'generate',
        requestId,
        text,
        voiceId: voiceId || this.config?.voiceId || 'af_bella',
      })
    })
  }

  /**
   * Split text into TTS-friendly chunks
   */
  splitIntoChunks(text: string): string[] {
    return splitTextIntoChunks(text, this.config?.maxChunkChars || 320)
  }

  /**
   * Cancel pending requests
   */
  cancel(requestId?: string): void {
    if (!this.worker) return

    this.worker.postMessage({ type: 'cancel', requestId })

    if (requestId) {
      const req = this.pendingRequests.get(requestId)
      req?.reject(new DOMException('Cancelled', 'AbortError') as unknown as Error)
      this.pendingRequests.delete(requestId)
    } else {
      for (const [id, req] of this.pendingRequests) {
        req.reject(new DOMException('Cancelled', 'AbortError') as unknown as Error)
        this.pendingRequests.delete(id)
      }
    }
  }

  cancelAll(): void {
    this.cancel()
  }

  // Getters
  getIsReady(): boolean { return this.isReady }
  getIsLoading(): boolean { return this.isLoading }
  getConfig(): TTSConfig | null { return this.config }
  isUsingWasm(): boolean { return this.config?.device === 'wasm' }

  // Debug
  setLogFullChunkText(enabled: boolean): void {
    this.logFullChunkText = enabled
  }

  // Voice
  async setVoice(voiceId: string): Promise<void> {
    if (this.config) this.config.voiceId = voiceId
    await settingsRepository.set('voiceId', voiceId)
  }

  // Callbacks
  onAudio(callback: AudioCallback): void { this.onAudioCallback = callback }
  onProgress(callback: ProgressCallback): void { this.onProgressCallback = callback }
  onError(callback: ErrorCallback): void { this.onErrorCallback = callback }
  onReady(callback: ReadyCallback): void { this.onReadyCallback = callback }

  /**
   * Cleanup
   */
  destroy(): void {
    this.cancel()
    if (this.initReject) {
      this.initReject(new Error('TTS service destroyed'))
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

// Singleton
export const ttsService = new TTSService()
