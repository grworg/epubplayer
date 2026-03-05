/**
 * KittenTTS Service
 *
 * Lightweight 15M-parameter neural TTS (~24MB download).
 * Uses ONNX Runtime Web (WASM) — works well on any device without GPU.
 * 8 voices, 24kHz output, English only.
 */

import { createLogger, handleWorkerLog, type WorkerLogMessage } from '@/services/logging'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { splitTextIntoChunks } from './textChunking'

const log = createLogger('tts')

// ============================================================================
// Types
// ============================================================================

export interface KittenConfig {
  voiceId: string
  speed: number
  maxChunkChars: number
}

export interface KittenGeneratedAudio {
  requestId: string
  blob: Blob
  duration: number
  chunkIndex: number
  text: string
}

type AudioCallback = (audio: KittenGeneratedAudio) => void
type ProgressCallback = (status: string, progress?: number) => void
type ErrorCallback = (error: string, requestId?: string) => void
type ReadyCallback = () => void

// ============================================================================
// Available KittenTTS Voices
// ============================================================================

export const KITTEN_VOICES = [
  { id: 'expr-voice-2-f', name: 'Female 1', description: 'Expressive female voice' },
  { id: 'expr-voice-3-f', name: 'Female 2', description: 'Alternative female voice' },
  { id: 'expr-voice-4-f', name: 'Female 3', description: 'Third female voice' },
  { id: 'expr-voice-5-f', name: 'Female 4', description: 'Fourth female voice' },
  { id: 'expr-voice-2-m', name: 'Male 1', description: 'Default male voice' },
  { id: 'expr-voice-3-m', name: 'Male 2', description: 'Alternative male voice' },
  { id: 'expr-voice-4-m', name: 'Male 3', description: 'Third male voice' },
  { id: 'expr-voice-5-m', name: 'Male 4', description: 'Fourth male voice' },
] as const

export type KittenVoiceId = (typeof KITTEN_VOICES)[number]['id']

const DEFAULT_VOICE: KittenVoiceId = 'expr-voice-2-m'
const DEFAULT_SPEED = 1.0
const KITTEN_MAX_CHUNK_CHARS = 250

// ============================================================================
// KittenTTS Service Class
// ============================================================================

class KittenService {
  private worker: Worker | null = null
  private isReady = false
  private isLoading = false
  private config: KittenConfig | null = null

  private onAudioCallback?: AudioCallback
  private onProgressCallback?: ProgressCallback
  private onErrorCallback?: ErrorCallback
  private onReadyCallback?: ReadyCallback

  private initPromise: Promise<void> | null = null
  private initResolve: (() => void) | null = null
  private initReject: ((error: Error) => void) | null = null

  private pendingRequests = new Map<
    string,
    {
      chunkIndex: number
      text: string
      resolve: (audio: KittenGeneratedAudio) => void
      reject: (error: Error) => void
    }
  >()
  private requestCounter = 0

  async initialize(configOverrides?: Partial<KittenConfig>): Promise<void> {
    if (this.isReady && this.worker && this.config) {
      const desired = await this.computeDesiredConfig(configOverrides)
      const same =
        desired.voiceId === this.config.voiceId &&
        desired.speed === this.config.speed &&
        desired.maxChunkChars === this.config.maxChunkChars

      if (same) return
      log.info('Kitten config changed, reinitializing worker')
      this.destroy()
    }

    if (this.isLoading && this.initPromise) {
      return this.initPromise
    }

    this.isLoading = true

    this.initPromise = new Promise<void>((resolve, reject) => {
      this.initResolve = resolve
      this.initReject = reject
    })

    try {
      this.config = await this.computeDesiredConfig(configOverrides)
      log.info('KittenTTS initializing', { config: this.config })

      this.worker = new Worker(new URL('./kittenWorker.ts', import.meta.url), {
        type: 'module',
      })

      this.setupWorkerListeners()

      this.worker.postMessage({
        type: 'init',
        voiceId: this.config.voiceId,
      })

      return this.initPromise
    } catch (error) {
      this.isLoading = false
      this.initReject?.(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  private async computeDesiredConfig(configOverrides?: Partial<KittenConfig>): Promise<KittenConfig> {
    const [kittenVoice, maxChunkChars] = await Promise.all([
      settingsRepository.get('kittenVoice'),
      settingsRepository.get('maxChunkChars'),
    ])

    return {
      voiceId: configOverrides?.voiceId ?? kittenVoice,
      speed: configOverrides?.speed ?? DEFAULT_SPEED,
      maxChunkChars: Math.min(configOverrides?.maxChunkChars ?? maxChunkChars, KITTEN_MAX_CHUNK_CHARS),
    }
  }

  private setupWorkerListeners() {
    if (!this.worker) return

    this.worker.onmessage = (event) => {
      const data = event.data

      switch (data.type) {
        case 'log':
          handleWorkerLog(data as WorkerLogMessage)
          break

        case 'progress':
          this.onProgressCallback?.(data.status, data.progress)
          break

        case 'ready':
          log.info('KittenTTS models ready')
          this.isReady = true
          this.isLoading = false
          this.initResolve?.()
          this.initPromise = null
          this.initResolve = null
          this.initReject = null
          this.onReadyCallback?.()
          break

        case 'audio':
          log.debug('KittenTTS audio generated', { requestId: data.requestId })
          this.handleAudioResponse(data)
          break

        case 'error':
          log.error('KittenTTS error', { message: data.message })
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

        case 'cancelled':
          log.debug('KittenTTS generation cancelled', { requestId: data.requestId })
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
      log.error('KittenTTS worker error', error)
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

    const audio: KittenGeneratedAudio = {
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

  async generateChunk(text: string, chunkIndex: number, voiceId?: string): Promise<KittenGeneratedAudio> {
    if (!this.isReady) {
      log.debug('KittenTTS not ready, initializing...')
    }
    await this.initialize()

    if (!this.worker || !this.isReady) {
      throw new Error('KittenTTS service not initialized')
    }

    const requestId = `kitten_${++this.requestCounter}_${Date.now()}`
    log.debug('KittenTTS generating chunk', { chunkIndex, textLength: text.length, requestId })

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
        reject(new Error(`KittenTTS generation timed out after ${Math.round(timeoutMs / 1000)}s`))
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
        speed: this.config?.speed || DEFAULT_SPEED,
      })
    })
  }

  cancel(requestId?: string): void {
    if (!this.worker) return

    this.worker.postMessage({ type: 'cancel', requestId })

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

  cancelAll(): void {
    this.cancel()
  }

  splitIntoChunks(text: string): string[] {
    const maxChars = this.config?.maxChunkChars || 300
    return splitTextIntoChunks(text, maxChars)
  }

  getIsReady(): boolean {
    return this.isReady
  }

  getIsLoading(): boolean {
    return this.isLoading
  }

  getConfig(): KittenConfig | null {
    return this.config
  }

  async setVoice(voiceId: string): Promise<void> {
    await settingsRepository.set('kittenVoice', voiceId)
    if (this.config) {
      this.config.voiceId = voiceId
    }
    if (this.worker && this.isReady) {
      this.worker.postMessage({ type: 'setVoice', voiceId })
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

  destroy(): void {
    this.cancel()
    if (this.initReject) {
      this.initReject(new Error('KittenTTS service destroyed during initialization'))
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

export const kittenService = new KittenService()
